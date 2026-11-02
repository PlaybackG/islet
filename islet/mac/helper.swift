// Islet helper для macOS: те же команды и тот же JSON по строкам, что у helper.ps1.
// Собирается в dylib и грузится через /usr/bin/perl: с macOS 15.4 MediaRemote отвечает только системным процессам.
import AppKit
import CoreAudio
import CoreWLAN
import Foundation
import SQLite3
import SystemConfiguration
import Vision

struct Fail: Error { let text: String; init(_ t: String) { text = t } }

func sym<T>(_ lib: String, _ name: String, _ type: T.Type) -> T? {
  guard let h = dlopen(lib, RTLD_NOW), let p = dlsym(h, name) else { return nil }
  return unsafeBitCast(p, to: type)
}

// ---------- Музыка ----------

let MR = "/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote"
typealias InfoBlock = @convention(block) (NSDictionary?) -> Void
typealias PidBlock = @convention(block) (Int32) -> Void
let mrInfo = sym(MR, "MRMediaRemoteGetNowPlayingInfo", (@convention(c) (DispatchQueue, @escaping InfoBlock) -> Void).self)
let mrPid = sym(MR, "MRMediaRemoteGetNowPlayingApplicationPID", (@convention(c) (DispatchQueue, @escaping PidBlock) -> Void).self)
let mrSend = sym(MR, "MRMediaRemoteSendCommand", (@convention(c) (Int32, CFDictionary?) -> Bool).self)

func wait<T>(_ fallback: T, _ start: (@escaping (T) -> Void) -> Void) -> T {
  let sem = DispatchSemaphore(value: 0)
  let lock = NSLock()
  var out = fallback
  start { v in lock.lock(); out = v; lock.unlock(); sem.signal() }
  _ = sem.wait(timeout: .now() + 3)
  lock.lock(); defer { lock.unlock() }
  return out
}

func mediaGet(_ a: [String: Any]) -> [String: Any] {
  let q = DispatchQueue.global()
  let info = wait(NSDictionary?.none) { done in mrInfo?(q) { done($0) } }
  let pid = wait(Int32(0)) { done in mrPid?(q) { done($0) } }
  let name = NSRunningApplication(processIdentifier: pid)?.localizedName ?? ""
  let title = info?["kMRMediaRemoteNowPlayingInfoTitle"] as? String ?? ""
  if title.isEmpty { return ["active": false, "players": name.isEmpty ? [] : [name]] }
  let artist = info?["kMRMediaRemoteNowPlayingInfoArtist"] as? String ?? ""
  let key = "\(name)|\(title)|\(artist)"
  var thumb: Any = NSNull()
  if key != a["haveThumb"] as? String, let d = info?["kMRMediaRemoteNowPlayingInfoArtworkData"] as? Data {
    let mime = info?["kMRMediaRemoteNowPlayingInfoArtworkMIMEType"] as? String ?? "image/jpeg"
    thumb = "data:\(mime);base64," + d.base64EncodedString()
  }
  let rate = info?["kMRMediaRemoteNowPlayingInfoPlaybackRate"] as? Double ?? 0
  let at = info?["kMRMediaRemoteNowPlayingInfoTimestamp"] as? Date ?? Date()
  return [
    "active": true, "app": name, "title": title, "artist": artist,
    "album": info?["kMRMediaRemoteNowPlayingInfoAlbum"] as? String ?? "",
    "status": rate > 0 ? "Playing" : "Paused",
    "position": info?["kMRMediaRemoteNowPlayingInfoElapsedTime"] as? Double ?? 0,
    "duration": info?["kMRMediaRemoteNowPlayingInfoDuration"] as? Double ?? 0,
    "updated": Int(at.timeIntervalSince1970 * 1000), "key": key, "thumb": thumb, "players": [name],
  ]
}

func mediaCtl(_ a: [String: Any]) -> Bool {
  let cmd: [String: Int32] = ["play": 0, "pause": 1, "playpause": 2, "next": 4, "prev": 5]
  guard let c = cmd[a["action"] as? String ?? ""] else { return false }
  return mrSend?(c, nil) ?? false
}

// ---------- Звук ----------

let VOLUME: AudioObjectPropertySelector = 0x766D_7663 // kAudioHardwareServiceDeviceProperty_VirtualMainVolume

func addr(_ sel: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: sel, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}
func getProp<T>(_ obj: AudioObjectID, _ a: AudioObjectPropertyAddress, _ zero: T) -> T? {
  var v = zero, size = UInt32(MemoryLayout<T>.size), a = a
  return AudioObjectGetPropertyData(obj, &a, 0, nil, &size, &v) == 0 ? v : nil
}
func setProp<T>(_ obj: AudioObjectID, _ a: AudioObjectPropertyAddress, _ val: T) -> Bool {
  var v = val, a = a
  return AudioObjectSetPropertyData(obj, &a, 0, nil, UInt32(MemoryLayout<T>.size), &v) == 0
}
func defaultDevice(input: Bool) throws -> AudioObjectID {
  let sel = input ? kAudioHardwarePropertyDefaultInputDevice : kAudioHardwarePropertyDefaultOutputDevice
  guard let d = getProp(AudioObjectID(kAudioObjectSystemObject), addr(sel), AudioObjectID(0)), d != 0 else { throw Fail("no-audio-device") }
  return d
}
func volState() throws -> [String: Any] {
  let d = try defaultDevice(input: false), s = kAudioObjectPropertyScopeOutput
  return ["level": Double(getProp(d, addr(VOLUME, s), Float32(1)) ?? 1), "muted": (getProp(d, addr(kAudioDevicePropertyMute, s), UInt32(0)) ?? 0) != 0]
}
func volSet(_ a: [String: Any]) throws -> [String: Any] {
  let d = try defaultDevice(input: false), s = kAudioObjectPropertyScopeOutput
  var level = a["level"] as? Double
  if let dl = a["delta"] as? Double { level = Double(getProp(d, addr(VOLUME, s), Float32(0)) ?? 0) + dl }
  if let l = level { _ = setProp(d, addr(VOLUME, s), Float32(max(0, min(1, l)))) }
  if let m = a["mute"] as? Bool { _ = setProp(d, addr(kAudioDevicePropertyMute, s), UInt32(m ? 1 : 0)) }
  return try volState()
}
func audioList() throws -> [String: Any] {
  let sys = AudioObjectID(kAudioObjectSystemObject)
  var a = addr(kAudioHardwarePropertyDevices), size = UInt32(0)
  AudioObjectGetPropertyDataSize(sys, &a, 0, nil, &size)
  var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  AudioObjectGetPropertyData(sys, &a, 0, nil, &size, &ids)
  let def = try defaultDevice(input: false)
  var list: [[String: Any]] = []
  for d in ids {
    var sa = addr(kAudioDevicePropertyStreams, kAudioObjectPropertyScopeOutput), n = UInt32(0)
    AudioObjectGetPropertyDataSize(d, &sa, 0, nil, &n)
    if n == 0 { continue }
    let name = getProp(d, addr(kAudioObjectPropertyName), Unmanaged<CFString>?.none)??.takeRetainedValue() as String? ?? "Устройство"
    list.append(["id": String(d), "name": name, "desc": "", "def": d == def])
  }
  return ["list": list]
}
func audioSet(_ a: [String: Any]) -> Bool {
  guard let d = AudioObjectID(a["id"] as? String ?? "") else { return false }
  let sys = AudioObjectID(kAudioObjectSystemObject)
  _ = setProp(sys, addr(kAudioHardwarePropertyDefaultSystemOutputDevice), d)
  return setProp(sys, addr(kAudioHardwarePropertyDefaultOutputDevice), d)
}

// У встроенного микрофона часто нет отдельного mute: тогда выключаем громкостью и помним прежнюю.
var micSaved: Float32 = 0.75
func micMuted(_ d: AudioObjectID) -> Bool {
  let s = kAudioObjectPropertyScopeInput
  if let m = getProp(d, addr(kAudioDevicePropertyMute, s), UInt32(0)), m != 0 { return true }
  return (getProp(d, addr(VOLUME, s), Float32(1)) ?? 1) == 0
}
func micToggle() throws -> [String: Any] {
  let d = try defaultDevice(input: true), s = kAudioObjectPropertyScopeInput, off = !micMuted(d)
  if !setProp(d, addr(kAudioDevicePropertyMute, s), UInt32(off ? 1 : 0)) {
    if off { micSaved = getProp(d, addr(VOLUME, s), micSaved) ?? micSaved }
    _ = setProp(d, addr(VOLUME, s), off ? Float32(0) : micSaved)
  } else if !off, (getProp(d, addr(VOLUME, s), Float32(1)) ?? 1) == 0 { _ = setProp(d, addr(VOLUME, s), micSaved) }
  return ["muted": micMuted(d)]
}

// ---------- Яркость (только встроенный экран) ----------

let DS = "/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices"
let dsGet = sym(DS, "DisplayServicesGetBrightness", (@convention(c) (CGDirectDisplayID, UnsafeMutablePointer<Float>) -> Int32).self)
let dsSet = sym(DS, "DisplayServicesSetBrightness", (@convention(c) (CGDirectDisplayID, Float) -> Int32).self)

func builtinDisplay() throws -> CGDirectDisplayID {
  var ids = [CGDirectDisplayID](repeating: 0, count: 16), n = UInt32(0)
  CGGetOnlineDisplayList(16, &ids, &n)
  guard let d = ids.prefix(Int(n)).first(where: { CGDisplayIsBuiltin($0) != 0 }) else { throw Fail("no-brightness") }
  return d
}
func brightGet() throws -> [String: Any] {
  var v = Float(0)
  guard dsGet?(try builtinDisplay(), &v) == 0 else { throw Fail("no-brightness") }
  return ["level": Int((v * 100).rounded())]
}
func brightSet(_ a: [String: Any]) throws -> [String: Any] {
  let level = max(0, min(100, a["level"] as? Int ?? 50))
  guard dsSet?(try builtinDisplay(), Float(level) / 100) == 0 else { throw Fail("no-brightness") }
  return ["level": level]
}

// ---------- Текст с картинки ----------

func ocr(_ a: [String: Any]) throws -> String {
  guard let img = NSImage(contentsOfFile: a["path"] as? String ?? ""),
        let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { throw Fail("no-image") }
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.recognitionLanguages = ["ru-RU", "en-US"]
  try VNImageRequestHandler(cgImage: cg).perform([req])
  return (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

// ---------- Wi-Fi, Bluetooth, сеть ----------

let BT = "/System/Library/Frameworks/IOBluetooth.framework/IOBluetooth"
let btGet = sym(BT, "IOBluetoothPreferenceGetControllerPowerState", (@convention(c) () -> Int32).self)
let btSet = sym(BT, "IOBluetoothPreferenceSetControllerPowerState", (@convention(c) (Int32) -> Void).self)

// Без разрешения в Info.plist система убивает процесс, поэтому Bluetooth только из собранного Islet.app.
let btAllowed = getenv("ISLET_BT") != nil

func radiosGet() -> [[String: Any]] {
  var out: [[String: Any]] = []
  if let w = CWWiFiClient.shared().interface() { out.append(["kind": "WiFi", "state": w.powerOn() ? "On" : "Off", "name": w.interfaceName ?? "Wi-Fi"]) }
  if btAllowed, let g = btGet { out.append(["kind": "Bluetooth", "state": g() != 0 ? "On" : "Off", "name": "Bluetooth"]) }
  return out
}
func radiosSet(_ a: [String: Any]) throws -> [[String: Any]] {
  let on = a["on"] as? Bool ?? false
  if a["kind"] as? String == "WiFi" { try CWWiFiClient.shared().interface()?.setPower(on) } else if btAllowed { btSet?(on ? 1 : 0) }
  return radiosGet()
}

func exec(_ tool: String, _ args: [String]) -> String {
  let p = Process(), out = Pipe()
  p.executableURL = URL(fileURLWithPath: tool)
  p.arguments = args
  p.standardOutput = out
  p.standardError = Pipe()
  guard (try? p.run()) != nil else { return "" }
  let d = out.fileHandleForReading.readDataToEndOfFile()
  p.waitUntilExit()
  return String(decoding: d, as: UTF8.self)
}

func ipv4Interfaces() -> Set<String> {
  var head: UnsafeMutablePointer<ifaddrs>?, out = Set<String>()
  guard getifaddrs(&head) == 0 else { return out }
  defer { freeifaddrs(head) }
  var p = head
  while let i = p {
    if i.pointee.ifa_addr?.pointee.sa_family == UInt8(AF_INET), i.pointee.ifa_flags & UInt32(IFF_RUNNING) != 0 { out.insert(String(cString: i.pointee.ifa_name)) }
    p = i.pointee.ifa_next
  }
  return out
}

func netGet() -> [String: Any] {
  let up = ipv4Interfaces()
  var eth: Any = NSNull()
  for i in SCNetworkInterfaceCopyAll() as? [SCNetworkInterface] ?? [] where SCNetworkInterfaceGetInterfaceType(i) == kSCNetworkInterfaceTypeEthernet {
    if (SCNetworkInterfaceGetLocalizedDisplayName(i) as String?)?.hasPrefix("Thunderbolt") == true { continue }
    let on = up.contains(SCNetworkInterfaceGetBSDName(i) as String? ?? "")
    if on || eth is NSNull { eth = ["up": on] }
  }
  var vpn: Any = NSNull()
  if up.contains(where: { $0.hasPrefix("utun") || $0.hasPrefix("ipsec") || $0.hasPrefix("ppp") }) {
    let line = exec("/usr/sbin/scutil", ["--nc", "list"]).split(separator: "\n").first { $0.contains("(Connected)") }
    vpn = line?.split(separator: "\"").dropFirst().first.map(String.init) ?? "VPN"
  }
  return ["eth": eth, "vpn": vpn]
}

// ---------- Система ----------

func isDark() -> Bool {
  CFPreferencesAppSynchronize(kCFPreferencesAnyApplication)
  return CFPreferencesCopyAppValue("AppleInterfaceStyle" as CFString, kCFPreferencesAnyApplication) as? String == "Dark"
}
func theme(_ a: [String: Any]) -> [String: Any] {
  if a["toggle"] as? Bool == true {
    let s = "tell application \"System Events\" to tell appearance preferences to set dark mode to not dark mode"
    _ = exec("/usr/bin/osascript", ["-e", s])
  }
  return ["dark": isDark()]
}

func appsList() -> [[String: Any]] {
  let fm = FileManager.default, home = fm.homeDirectoryForCurrentUser.path
  var seen = Set<String>(), out: [[String: Any]] = []
  func scan(_ dir: String, _ depth: Int) {
    for n in (try? fm.contentsOfDirectory(atPath: dir)) ?? [] {
      let p = dir + "/" + n
      if n.hasSuffix(".app") {
        let name = fm.displayName(atPath: p).replacingOccurrences(of: ".app", with: "")
        if seen.insert(name).inserted { out.append(["name": name, "id": p]) }
      } else if depth > 0, !n.hasPrefix(".") { scan(p, depth - 1) }
    }
  }
  for d in ["/Applications", "/System/Applications", home + "/Applications"] { scan(d, 2) }
  return out
}

func appIcon(_ a: [String: Any]) -> String {
  let id = a["id"] as? String ?? ""
  let url = id.hasPrefix("/") ? URL(fileURLWithPath: id) : NSWorkspace.shared.urlForApplication(withBundleIdentifier: id)
  guard let url else { return "" }
  let icon = NSWorkspace.shared.icon(forFile: url.path), px = 64
  guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
        let ctx = NSGraphicsContext(bitmapImageRep: rep) else { return "" }
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = ctx
  icon.draw(in: NSRect(x: 0, y: 0, width: px, height: px))
  NSGraphicsContext.restoreGraphicsState()
  guard let d = rep.representation(using: .png, properties: [:]) else { return "" }
  return "data:image/png;base64," + d.base64EncodedString()
}

func clipFiles(_ a: [String: Any]) -> Bool {
  let urls = (a["paths"] as? [String] ?? []).map { URL(fileURLWithPath: $0) as NSURL }
  NSPasteboard.general.clearContents()
  return NSPasteboard.general.writeObjects(urls)
}
func clipGetFiles() -> [String] {
  let o = NSPasteboard.general.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true])
  return (o as? [URL] ?? []).map(\.path)
}

func lockScreen() throws -> Bool {
  guard let f = sym("/System/Library/PrivateFrameworks/login.framework/login", "SACLockScreenImmediate", (@convention(c) () -> Int32).self) else { throw Fail("no-lock") }
  _ = f()
  return true
}

// ---------- Уведомления: база центра уведомлений, нужен «Полный доступ к диску» ----------

func notifsGet(_ a: [String: Any]) throws -> [String: Any] {
  let path = a["db"] as? String ?? FileManager.default.homeDirectoryForCurrentUser.path + "/Library/Group Containers/group.com.apple.usernoted/db2/db"
  guard FileManager.default.isReadableFile(atPath: path) else { throw Fail("no-access") }
  var db: OpaquePointer?
  guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else { sqlite3_close(db); throw Fail("no-access") }
  defer { sqlite3_close(db) }
  let after = a["after"] as? Int ?? -1
  var st: OpaquePointer?
  let sql = "SELECT r.rec_id, a.identifier, r.data FROM record r JOIN app a ON a.app_id = r.app_id WHERE r.rec_id > ? ORDER BY r.rec_id"
  guard sqlite3_prepare_v2(db, sql, -1, &st, nil) == SQLITE_OK else { throw Fail("no-access") }
  defer { sqlite3_finalize(st) }
  sqlite3_bind_int64(st, 1, Int64(max(after, 0)))
  var last = max(after, 0), items: [[String: Any]] = []
  while sqlite3_step(st) == SQLITE_ROW {
    last = Int(sqlite3_column_int64(st, 0))
    if after < 0 { continue } // первый круг: только запоминаем, где конец
    guard let blob = sqlite3_column_blob(st, 2) else { continue }
    let d = Data(bytes: blob, count: Int(sqlite3_column_bytes(st, 2)))
    guard let p = try? PropertyListSerialization.propertyList(from: d, format: nil) as? [String: Any], let r = p["req"] as? [String: Any] else { continue }
    let title = r["titl"] as? String ?? "", subt = r["subt"] as? String ?? "", body = r["body"] as? String ?? ""
    if title.isEmpty && body.isEmpty { continue }
    items.append(["app": String(cString: sqlite3_column_text(st, 1)), "title": title, "body": [subt, body].filter { !$0.isEmpty }.joined(separator: " · ")])
  }
  return ["last": last, "items": items]
}

// Чёлка: ширина выреза — то, что не занято областями меню слева и справа от него.
func notches() -> [[String: Any]] {
  NSScreen.screens.compactMap { s in
    guard s.safeAreaInsets.top > 0, let l = s.auxiliaryTopLeftArea, let r = s.auxiliaryTopRightArea,
          let id = s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return nil }
    return ["id": id.intValue, "w": Double(s.frame.width - l.width - r.width), "h": Double(s.safeAreaInsets.top)]
  }
}

// ---------- Цикл запросов ----------

func invoke(_ cmd: String, _ a: [String: Any]) throws -> Any {
  switch cmd {
  case "ping": return "pong"
  case "media.get": return mediaGet(a)
  case "media.ctl": return mediaCtl(a)
  case "vol.get": return try volState()
  case "vol.set": return try volSet(a)
  case "audio.list": return try audioList()
  case "audio.set": return audioSet(a)
  case "bright.get": return try brightGet()
  case "bright.set": return try brightSet(a)
  case "mic.get": return ["muted": micMuted(try defaultDevice(input: true))]
  case "mic.toggle": return try micToggle()
  case "ocr": return try ocr(a)
  case "radios.get": return radiosGet()
  case "radios.set": return try radiosSet(a)
  case "net.get": return netGet()
  case "theme": return theme(a)
  case "apps": return appsList()
  case "appicon": return appIcon(a)
  case "clip.files": return clipFiles(a)
  case "clip.getfiles": return clipGetFiles()
  case "lock": return try lockScreen()
  case "notifs.get": return try notifsGet(a)
  case "notch": return notches()
  default: throw Fail("unknown command \(cmd)")
  }
}

@_cdecl("islet_helper")
public func isletHelper() {
  while let line = readLine() {
    if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
    var res: [String: Any] = ["id": 0, "ok": false]
    autoreleasepool {
      do {
        guard let req = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else { throw Fail("bad request") }
        res["id"] = req["id"] ?? 0
        res["result"] = try invoke(req["cmd"] as? String ?? "", req["args"] as? [String: Any] ?? [:])
        res["ok"] = true
      } catch let e as Fail { res["error"] = e.text } catch { res["error"] = error.localizedDescription }
    }
    if let d = try? JSONSerialization.data(withJSONObject: res) { FileHandle.standardOutput.write(d + Data("\n".utf8)) }
  }
}
