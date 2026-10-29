#!/usr/bin/env bash
# Stage HyzeVM and the QEMU it runs on into the app bundle, so the agents' computers need nothing installed first.
#
# HyzeVM (apps/hyzevm, MIT) is the machine manager: one Debian machine per agent, with a desktop to watch and
# take over. It drives QEMU, so the bundle carries QEMU too, with every library it links against copied in and
# re-pointed at the bundle: a Homebrew QEMU would only run where Homebrew is. The machine that *builds* the app
# needs `brew install qemu` once; the reader never does.
#
#   resources/hyzevm/bin/hyzevm             the CLI the app drives (`binpath::shipped_hyzevm`)
#   resources/hyzevm/qemu/bin/              qemu-system-<arch> and qemu-img
#   resources/hyzevm/qemu/lib/              their dylibs, re-pointed with @executable_path / @loader_path
#   resources/hyzevm/qemu/share/qemu/       firmware and ROMs (`HYZEVM_QEMU_DIR` points at `qemu/`)
#
# QEMU is GPL-2.0: the licence texts are copied beside it, and the source is the upstream release named in
# `qemu/VERSION`. macOS only for now; Linux and Windows hosts would stage their own QEMU the same way.
#
# usage: scripts/vendor-hyzevm.sh [--force]
# Run it before `pnpm tauri build`. The staged tree is gitignored build output.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/../hyzevm"
DEST="$ROOT/src-tauri/resources/hyzevm"

if [ -x "$DEST/bin/hyzevm" ] && [ -x "$DEST/qemu/bin/qemu-img" ] && [ "${1:-}" != "--force" ]; then
  echo "already staged: $("$DEST/bin/hyzevm" --version)"
  exit 0
fi

[ "$(uname -s)" = "Darwin" ] || { echo "vendor-hyzevm.sh only stages macOS for now" >&2; exit 1; }
BREW="$(brew --prefix qemu 2>/dev/null || true)"
[ -n "$BREW" ] && [ -d "$BREW" ] || { echo "install QEMU on this build machine once: brew install qemu" >&2; exit 1; }
case "$(uname -m)" in arm64) SYS=qemu-system-aarch64 ;; *) SYS=qemu-system-x86_64 ;; esac

echo "building hyzevm"
(cd "$SRC" && cargo build --release)

rm -rf "$DEST"
mkdir -p "$DEST/bin" "$DEST/qemu/bin" "$DEST/qemu/lib" "$DEST/qemu/share/qemu"
cp "$SRC/target/release/hyzevm" "$DEST/bin/hyzevm"

echo "copying QEMU and its libraries"
for b in "$SYS" qemu-img; do cp -L "$BREW/bin/$b" "$DEST/qemu/bin/$b"; done

# Every non-system dylib the two binaries load, followed recursively.
python3 - "$DEST/qemu" <<'PY'
import os, re, shutil, subprocess, sys
dest = sys.argv[1]
lib = os.path.join(dest, "lib")
sysprefix = ("/usr/lib", "/System")

def deps(path):
    out = subprocess.run(["otool", "-L", path], capture_output=True, text=True, check=True).stdout.splitlines()[1:]
    return [m.group(1) for m in (re.match(r"\s+(\S+)", l) for l in out) if m]

def resolve(ref, owner):
    if ref.startswith("@rpath/"):
        for base in ("/opt/homebrew/lib", "/usr/local/lib"):
            p = os.path.join(base, ref[7:])
            if os.path.exists(p):
                return os.path.realpath(p)
        return None
    return os.path.realpath(ref) if os.path.exists(ref) else None

copied = {}
queue = [os.path.join(dest, "bin", b) for b in os.listdir(os.path.join(dest, "bin"))]
while queue:
    cur = queue.pop()
    for ref in deps(cur):
        if ref.startswith(sysprefix) or ref.startswith("@loader_path") or ref.startswith("@executable_path"):
            continue
        real = resolve(ref, cur)
        if not real or real in copied:
            continue
        name = os.path.basename(real)
        target = os.path.join(lib, name)
        shutil.copy2(real, target)
        os.chmod(target, 0o755)
        copied[real] = name
        queue.append(target)

def retarget(path, prefix):
    for ref in deps(path):
        if ref.startswith(sysprefix) or ref.startswith("@loader_path") or ref.startswith("@executable_path"):
            continue
        real = resolve(ref, path)
        if real and real in copied:
            subprocess.run(["install_name_tool", "-change", ref, f"{prefix}/{copied[real]}", path], check=True, capture_output=True)

for name in os.listdir(lib):
    p = os.path.join(lib, name)
    subprocess.run(["install_name_tool", "-id", f"@loader_path/{name}", p], check=True, capture_output=True)
    retarget(p, "@loader_path")
for b in os.listdir(os.path.join(dest, "bin")):
    retarget(os.path.join(dest, "bin", b), "@executable_path/../lib")
print(f"{len(copied)} libraries")
PY

# HVF needs the hypervisor entitlement on the binary that asks for it; changing install names broke the signature.
ENT="$(mktemp)"
cat >"$ENT" <<'PL'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>com.apple.security.hypervisor</key><true/></dict></plist>
PL
for f in "$DEST"/qemu/lib/*.dylib "$DEST"/qemu/bin/qemu-img; do codesign --force -s - "$f" >/dev/null 2>&1; done
codesign --force -s - --entitlements "$ENT" "$DEST/qemu/bin/$SYS" >/dev/null 2>&1
codesign --force -s - "$DEST/bin/hyzevm" >/dev/null 2>&1
rm -f "$ENT"

# Firmware and ROMs: the UEFI image the machine boots from, the network ROMs and the keyboard maps.
S="$BREW/share/qemu"
for f in edk2-aarch64-code.fd edk2-x86_64-code.fd efi-virtio.rom efi-e1000.rom efi-e1000e.rom bios-256k.bin vgabios-stdvga.bin; do
  [ -e "$S/$f" ] && cp -L "$S/$f" "$DEST/qemu/share/qemu/$f"
done
cp -R "$S/keymaps" "$DEST/qemu/share/qemu/keymaps"
cp -R "$S/firmware" "$DEST/qemu/share/qemu/firmware" 2>/dev/null || true
cp "$S/edk2-licenses.txt" "$DEST/qemu/share/qemu/" 2>/dev/null || true
[ -f "$BREW/COPYING" ] && cp "$BREW/COPYING" "$DEST/qemu/COPYING"
"$DEST/qemu/bin/$SYS" --version | head -1 >"$DEST/qemu/VERSION"

# Homebrew ships read-only files; Tauri copies this tree into its output and cannot overwrite them on the next build.
chmod -R u+w "$DEST"

echo "staged: $("$DEST/bin/hyzevm" --version) with $(cat "$DEST/qemu/VERSION")"
du -sh "$DEST"
