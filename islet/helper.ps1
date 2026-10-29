# Islet helper: one long-lived process that answers JSON requests on stdin.
# WinRT (media, OCR, radios) and Core Audio live here; everything else is in Node.
$ErrorActionPreference = 'Stop'
try {
  [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
} catch {}

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskOp = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Await($op, [Type]$type, [int]$ms = 6000) {
  $task = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait($ms)) { throw 'timeout' }
  $task.Result
}

foreach ($t in @(
  'Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control',
  'Windows.Storage.StorageFile, Windows.Storage',
  'Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams',
  'Windows.Media.Ocr.OcrEngine, Windows.Foundation',
  'Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics',
  'Windows.Globalization.Language, Windows.Globalization',
  'Windows.Devices.Radios.Radio, Windows.System.Devices'
)) {
  try { Invoke-Expression "`$null = [$t, ContentType=WindowsRuntime]" } catch {}
}

Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float level, Guid ctx);
  int j();
  int GetMasterVolumeLevelScalar(out float level);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid ctx);
  int GetMute(out bool mute);
}
[StructLayout(LayoutKind.Sequential)] struct PropKey { public Guid fmt; public int pid; }
[StructLayout(LayoutKind.Explicit, Size = 24)] struct PropVar { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; }
[Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore {
  int GetCount(out int n); int GetAt(int i, out PropKey k);
  int GetValue(ref PropKey k, out PropVar v);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid id, int ctx, int p, out IAudioEndpointVolume aev);
  int OpenPropertyStore(int access, out IPropertyStore ps);
  int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}
[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection {
  int GetCount(out int n);
  int Item(int i, out IMMDevice dev);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection col);
  int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }
// Недокументированный, но стабильный с Windows 7 интерфейс — им пользуется сам микшер звука.
[Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPolicyConfig {
  int a(); int b(); int c(); int d(); int e(); int f(); int g(); int h(); int i(); int j();
  int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
}
[ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] class PolicyConfigCom { }

public class IsletDevice { public string id; public string name; public string desc; public bool def; }

public static class IsletAudio {
  static string Prop(IPropertyStore ps, int pid) {
    var k = new PropKey { fmt = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = pid };
    PropVar v;
    if (ps.GetValue(ref k, out v) != 0 || v.vt != 31) return "";
    return Marshal.PtrToStringUni(v.p);
  }
  public static IsletDevice[] Devices(int flow) {
    var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
    string defId = "";
    IMMDevice d0;
    if (en.GetDefaultAudioEndpoint(flow, 1, out d0) == 0) d0.GetId(out defId);
    IMMDeviceCollection col;
    Marshal.ThrowExceptionForHR(en.EnumAudioEndpoints(flow, 1, out col));
    int n; col.GetCount(out n);
    var res = new IsletDevice[n];
    for (int i = 0; i < n; i++) {
      IMMDevice dev; col.Item(i, out dev);
      string id; dev.GetId(out id);
      IPropertyStore ps; dev.OpenPropertyStore(0, out ps);
      res[i] = new IsletDevice { id = id, name = Prop(ps, 14), desc = Prop(ps, 2), def = id == defId };
    }
    return res;
  }
  public static void SetDefault(string id) {
    var pc = (IPolicyConfig)(new PolicyConfigCom());
    for (int r = 0; r < 3; r++) Marshal.ThrowExceptionForHR(pc.SetDefaultEndpoint(id, r));
  }
  static IAudioEndpointVolume Ep(int flow) {
    var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
    IMMDevice dev;
    Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(flow, 1, out dev));
    IAudioEndpointVolume v;
    var id = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref id, 23, 0, out v));
    return v;
  }
  public static float GetVolume(int flow) { float x; Marshal.ThrowExceptionForHR(Ep(flow).GetMasterVolumeLevelScalar(out x)); return x; }
  public static void SetVolume(int flow, float x) { Marshal.ThrowExceptionForHR(Ep(flow).SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, x)), Guid.Empty)); }
  public static bool GetMute(int flow) { bool m; Marshal.ThrowExceptionForHR(Ep(flow).GetMute(out m)); return m; }
  public static void SetMute(int flow, bool m) { Marshal.ThrowExceptionForHR(Ep(flow).SetMute(m, Guid.Empty)); }
}
'@

$script:mgr = $null
$script:asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))

function Get-Manager {
  if (-not $script:mgr) {
    $script:mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  }
  $script:mgr
}

function Get-Session($prefer) {
  $m = Get-Manager
  $all = @($m.GetSessions())
  $s = $null
  if ($prefer) { $s = $all | Where-Object { $_.SourceAppUserModelId -eq $prefer } | Select-Object -First 1 }
  if (-not $s) { $s = $m.GetCurrentSession() }
  if (-not $s -and $all.Count -gt 0) { $s = $all[0] }
  return @{ session = $s; all = $all }
}

function Read-Thumb($ref) {
  $st = Await ($ref.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  # PowerShell не умеет привести голый __ComObject к IInputStream, поэтому зовём через reflection.
  $net = $script:asStreamForRead.Invoke($null, @($st))
  $ms = New-Object System.IO.MemoryStream
  $net.CopyTo($ms)
  $net.Dispose()
  $type = $null
  try { $type = [Windows.Storage.Streams.IContentTypeProvider].GetProperty('ContentType').GetValue($st) } catch {}
  if (-not $type) { $type = 'image/png' }
  "data:$type;base64," + [Convert]::ToBase64String($ms.ToArray())
}

function Media-Get($a) {
  $x = Get-Session $a.prefer
  $s = $x.session
  $players = @($x.all | ForEach-Object { $_.SourceAppUserModelId })
  if (-not $s) { return @{ active = $false; players = $players } }
  $info = $s.GetPlaybackInfo()
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $tl = $s.GetTimelineProperties()
  $key = "$($s.SourceAppUserModelId)|$($p.Title)|$($p.Artist)"
  $thumb = $null
  if ($key -ne $a.haveThumb -and $p.Thumbnail) { try { $thumb = Read-Thumb $p.Thumbnail } catch {} }
  @{
    active = $true; app = $s.SourceAppUserModelId; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle
    status = "$($info.PlaybackStatus)"; position = $tl.Position.TotalSeconds; duration = $tl.EndTime.TotalSeconds
    updated = $tl.LastUpdatedTime.ToUnixTimeMilliseconds(); key = $key; thumb = $thumb; players = $players
  }
}

function Media-Ctl($a) {
  $s = (Get-Session $a.prefer).session
  if (-not $s) { return $false }
  switch ($a.action) {
    'playpause' { $op = $s.TryTogglePlayPauseAsync() }
    'next' { $op = $s.TrySkipNextAsync() }
    'prev' { $op = $s.TrySkipPreviousAsync() }
    default { return $false }
  }
  Await $op ([bool])
}

function Ocr-Lines($engine, $bmp) {
  $r = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
  @($r.Lines | ForEach-Object {
    $w = @($_.Words)
    $y = 0; $h = 10
    if ($w.Count -gt 0) { $y = $w[0].BoundingRect.Y; $h = $w[0].BoundingRect.Height }
    @{ text = $_.Text; y = $y; h = $h }
  })
}

function Ocr($a) {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($a.path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $ru = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'ru'))
  $en = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'en-US'))
  if (-not $ru -and -not $en) {
    $any = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if (-not $any) { throw 'no-ocr-language' }
    return ((Ocr-Lines $any $bmp) | ForEach-Object { $_.text }) -join "`n"
  }
  if (-not $ru) { return ((Ocr-Lines $en $bmp) | ForEach-Object { $_.text }) -join "`n" }
  if (-not $en) { return ((Ocr-Lines $ru $bmp) | ForEach-Object { $_.text }) -join "`n" }
  # Both engines: per line, Cyrillic lines come from the Russian engine, the rest from English.
  $ruLines = Ocr-Lines $ru $bmp
  $enLines = Ocr-Lines $en $bmp
  $out = foreach ($l in $ruLines) {
    if ($l.text -match '[Ѐ-ӿ]') { $l.text; continue }
    $match = $enLines | Where-Object { [Math]::Abs($_.y - $l.y) -lt [Math]::Max(6, $l.h / 2) } | Select-Object -First 1
    if ($match) { $match.text } else { $l.text }
  }
  @($out) -join "`n"
}

function Radios-Get {
  $null = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
  $list = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
  @($list | ForEach-Object { @{ kind = "$($_.Kind)"; state = "$($_.State)"; name = $_.Name } })
}

function Radios-Set($a) {
  $list = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
  $state = if ($a.on) { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
  foreach ($r in $list) {
    if ("$($r.Kind)" -eq $a.kind) { $null = Await ($r.SetStateAsync($state)) ([Windows.Devices.Radios.RadioAccessStatus]) }
  }
  Radios-Get
}

# System tiles: wired adapter and VPN tunnel (named after the adapter, happ-tun -> Happ, like Island).
function Net-Get {
  $all = @(Get-NetAdapter -IncludeHidden -ErrorAction SilentlyContinue)
  $eth = $all | Where-Object { $_.HardwareInterface -and $_.PhysicalMediaType -eq '802.3' } | Sort-Object { $_.Status -ne 'Up' } | Select-Object -First 1
  $tun = $all | Where-Object { $_.Status -eq 'Up' -and $_.MediaType -ne '802.3' -and $_.InterfaceDescription -match 'tun|tap|wireguard|openvpn|vpn' } | Select-Object -First 1
  $vpn = $null
  if ($tun) {
    $n = $tun.Name -replace '[-_ ]?(tun|tap)\d*$', ''
    if (-not $n) { $n = $tun.InterfaceDescription }
    $vpn = $n.Substring(0, 1).ToUpper() + $n.Substring(1)
  }
  @{ eth = if ($eth) { @{ up = ($eth.Status -eq 'Up') } } else { $null }; vpn = $vpn }
}

function Theme($a) {
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
  $light = (Get-ItemProperty -Path $key -Name AppsUseLightTheme -ErrorAction SilentlyContinue).AppsUseLightTheme
  if ($a.toggle) {
    $v = if ($light -eq 0) { 1 } else { 0 }
    Set-ItemProperty -Path $key -Name AppsUseLightTheme -Value $v -Type DWord
    Set-ItemProperty -Path $key -Name SystemUsesLightTheme -Value $v -Type DWord
    $light = $v
  }
  @{ dark = ($light -eq 0) }
}

# Иконка приложения по AUMID, как её рисует Пуск (и для Store-приложений). Компилируем при первом запросе.
function App-Icon($a) {
  if (-not ('IsletIcon' -as [type])) {
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Drawing; using System.Drawing.Imaging; using System.IO; using System.Runtime.InteropServices;
public static class IsletIcon {
  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr hbm); }
  [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx, cy; }
  [StructLayout(LayoutKind.Sequential)] struct BITMAP { public int bmType, bmWidth, bmHeight, bmWidthBytes; public ushort bmPlanes, bmBitsPixel; public IntPtr bmBits; }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory item);
  [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int size, out BITMAP bm);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
  public static string Get(string parsing, int px) {
    IShellItemImageFactory f;
    try { SHCreateItemFromParsingName(parsing, IntPtr.Zero, typeof(IShellItemImageFactory).GUID, out f); } catch { return ""; }
    IntPtr hbm;
    // SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK
    if (f.GetImage(new SIZE { cx = px, cy = px }, 0x4 | 0x1, out hbm) != 0) return "";
    try {
      BITMAP bm; GetObject(hbm, Marshal.SizeOf(typeof(BITMAP)), out bm);
      if (bm.bmBits == IntPtr.Zero || bm.bmBitsPixel != 32) return "";
      using (var b = new Bitmap(bm.bmWidth, bm.bmHeight, PixelFormat.Format32bppPArgb)) {
        var d = b.LockBits(new Rectangle(0, 0, bm.bmWidth, bm.bmHeight), ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb);
        var row = new byte[bm.bmWidthBytes];
        // DIB хранится снизу вверх
        for (int y = 0; y < bm.bmHeight; y++) {
          Marshal.Copy(bm.bmBits + (bm.bmHeight - 1 - y) * bm.bmWidthBytes, row, 0, row.Length);
          Marshal.Copy(row, 0, d.Scan0 + y * d.Stride, Math.Min(row.Length, d.Stride));
        }
        b.UnlockBits(d);
        using (var ms = new MemoryStream()) { b.Save(ms, ImageFormat.Png); return Convert.ToBase64String(ms.ToArray()); }
      }
    } finally { DeleteObject(hbm); }
  }
}
'@
  }
  $s = [IsletIcon]::Get('shell:AppsFolder\' + [string]$a.id, 48)
  if ($s) { 'data:image/png;base64,' + $s } else { '' }
}

function Invoke-Cmd($cmd, $a) {
  switch ($cmd) {
    'ping' { 'pong' }
    'media.get' { Media-Get $a }
    'media.ctl' { Media-Ctl $a }
    'vol.get' { @{ level = [IsletAudio]::GetVolume(0); muted = [IsletAudio]::GetMute(0) } }
    'vol.set' {
      if ($null -ne $a.delta) { [IsletAudio]::SetVolume(0, [IsletAudio]::GetVolume(0) + [float]$a.delta) }
      if ($null -ne $a.level) { [IsletAudio]::SetVolume(0, [float]$a.level) }
      if ($null -ne $a.mute) { [IsletAudio]::SetMute(0, [bool]$a.mute) }
      @{ level = [IsletAudio]::GetVolume(0); muted = [IsletAudio]::GetMute(0) }
    }
    # В обёртке, иначе один элемент PowerShell развернёт из массива.
    'audio.list' { @{ list = @([IsletAudio]::Devices(0) | ForEach-Object { @{ id = $_.id; name = $_.name; desc = $_.desc; def = $_.def } }) } }
    'audio.set' { [IsletAudio]::SetDefault([string]$a.id); $true }
    'bright.get' {
      # Есть только у встроенных экранов (ноутбуки); на ПК с монитором вернёт ошибку — и main перестанет спрашивать.
      $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1
      if ($b) { @{ level = [int]$b.CurrentBrightness } } else { throw 'no-brightness' }
    }
    'bright.set' {
      $m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Select-Object -First 1
      if (-not $m) { throw 'no-brightness' }
      $lv = [byte][Math]::Max(0, [Math]::Min(100, [int]$a.level))
      Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = $lv } | Out-Null
      @{ level = [int]$lv }
    }
    'mic.get' { @{ muted = [IsletAudio]::GetMute(1) } }
    'mic.toggle' { [IsletAudio]::SetMute(1, -not [IsletAudio]::GetMute(1)); @{ muted = [IsletAudio]::GetMute(1) } }
    'ocr' { Ocr $a }
    'radios.get' { Radios-Get }
    'radios.set' { Radios-Set $a }
    'net.get' { Net-Get }
    'theme' { Theme $a }
    'apps' { @(Get-StartApps | ForEach-Object { @{ name = $_.Name; id = $_.AppID } }) }
    'appicon' { App-Icon $a }
    'clip.files' { Set-Clipboard -Path @($a.paths); $true }
    'clip.getfiles' { @(Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }) }
    default { throw "unknown command $cmd" }
  }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $res = @{ id = 0; ok = $false }
  try {
    $req = $line | ConvertFrom-Json
    $res.id = $req.id
    $res.result = Invoke-Cmd $req.cmd $req.args
    $res.ok = $true
  } catch {
    $res.error = $_.Exception.Message
  }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}
