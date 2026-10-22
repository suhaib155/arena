#!/usr/bin/env bash
# android-artifact-acceptance.sh
#
# Read-only acceptance inspector for an EXISTING, owner-supplied Android APK or AAB.
#   - never builds, never uploads, never calls the network
#   - writes only to a private mktemp directory that it removes on exit
#   - never prints keystore or private-key material (certificate digests only)
#
# Usage:   android-artifact-acceptance.sh /path/to/app.apk|app.aab
#          android-artifact-acceptance.sh --self-test
#
# Exit codes: 0 every check ran and passed | 1 at least one FAIL
#             2 artifact argument missing / file not found (NOT RUN / ARTIFACT MISSING)
#             3 incomplete: at least one check NOT RUN (tool missing or input unreadable)
#             4 --self-test only: the NOT-RUN/FAIL discipline itself is broken
#
# Per-check status: PASS | FAIL | NOT RUN. A missing tool is always "NOT RUN / TOOL MISSING: <tool>"
# and can never be turned into a pass. Doc: docs/parallel/play-assurance/ANDROID_BINARY_ACCEPTANCE.md
# Checkpoint: 22 October 2026. Facts: ANDROID_FACTS.md (M/app.json:21-41, plugins/*) @ 15f7f87.

EXPECTED_PACKAGE="io.movenrun.app"
MIN_TARGET_SDK=36
HERMES_MAGIC="c61fbc03c1031 91f"; HERMES_MAGIC="${HERMES_MAGIC// /}"   # c6 1f bc 03 c1 03 19 1f

# Permissions allowed in the merged manifest. First three: app.json:28-31 and the INTERNET need of fetch.
# The rest are provisional Expo/React Native normal ones; their presence is NOT confirmed by source
# (no merged manifest was ever generated, ANDROID_FACTS.md section 1) so each is owner-reviewable:
#   ACCESS_NETWORK_STATE  - commonly added by RN/Expo networking modules
#   VIBRATE               - commonly added by expo-haptics
#   <package>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION - added by AndroidX core when a dependency uses it
ALLOWED_PERMS="android.permission.ACCESS_COARSE_LOCATION android.permission.ACCESS_FINE_LOCATION android.permission.INTERNET android.permission.ACCESS_NETWORK_STATE android.permission.VIBRATE ${EXPECTED_PACKAGE}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"
# Must never appear (app.json:32-41 blockedPermissions + the brief's list).
FORBIDDEN_PERMS="android.permission.ACCESS_BACKGROUND_LOCATION android.permission.FOREGROUND_SERVICE_LOCATION android.permission.FOREGROUND_SERVICE android.permission.SYSTEM_ALERT_WINDOW android.permission.RECORD_AUDIO android.permission.READ_EXTERNAL_STORAGE android.permission.WRITE_EXTERNAL_STORAGE android.permission.READ_MEDIA_IMAGES"

N_PASS=0; N_FAIL=0; N_NR=0

emit() { # name status evidence
  case "$2" in PASS) N_PASS=$((N_PASS+1));; FAIL) N_FAIL=$((N_FAIL+1));; *) N_NR=$((N_NR+1));; esac
  printf '[%s] %s: %s\n' "$2" "$1" "$3"
}
nr_tool() { emit "$1" "NOT RUN" "NOT RUN / TOOL MISSING: $2"; }

find_tool() { # echoes path, returns 1 if absent. MOVENRUN_ACCEPT_HIDE_TOOLS (comma list) is for --self-test only.
  local n=$1 p root
  case ",${MOVENRUN_ACCEPT_HIDE_TOOLS:-}," in *",$n,"*) return 1;; esac
  if p=$(command -v "$n" 2>/dev/null) && [ -n "$p" ]; then printf '%s\n' "$p"; return 0; fi
  for root in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}"; do
    [ -n "$root" ] || continue
    p=$(ls -d "$root"/build-tools/*/"$n" "$root"/cmdline-tools/*/bin/"$n" "$root"/platform-tools/"$n" 2>/dev/null | sort -V | tail -1)
    if [ -n "$p" ] && [ -x "$p" ]; then printf '%s\n' "$p"; return 0; fi
  done
  return 1
}

resolve_tools() {
  T_UNZIP=$(find_tool unzip) || T_UNZIP=""
  T_AAPT2=$(find_tool aapt2) || T_AAPT2=""
  T_APKANALYZER=$(find_tool apkanalyzer) || T_APKANALYZER=""
  T_ZIPALIGN=$(find_tool zipalign) || T_ZIPALIGN=""
  T_APKSIGNER=$(find_tool apksigner) || T_APKSIGNER=""
  T_OBJDUMP=$(find_tool llvm-objdump) || T_OBJDUMP=""
  T_READELF=$(find_tool readelf) || T_READELF=$(find_tool llvm-readelf) || T_READELF=""
  T_KEYTOOL=$(find_tool keytool) || T_KEYTOOL=""
  T_BUNDLETOOL=$(find_tool bundletool) || T_BUNDLETOOL=""
  T_JAVA=$(find_tool java) || T_JAVA=""
  if [ -z "$T_BUNDLETOOL" ] && [ -n "${BUNDLETOOL_JAR:-}" ] && [ -f "$BUNDLETOOL_JAR" ] && [ -n "$T_JAVA" ]; then
    T_BUNDLETOOL="$T_JAVA -jar $BUNDLETOOL_JAR"
  fi
}

num() { # hex or decimal -> decimal; empty if not numeric
  case "$1" in 0x*|0X*) printf '%d' "$1" 2>/dev/null;; ''|*[!0-9]*) printf '';; *) printf '%s' "$1";; esac
}

# ---------------------------------------------------------------- manifest parsing
# Stage 1a: aapt2 "dump xmltree" text -> events  (E<TAB>indent<TAB>element | A<TAB>key<TAB>value)
norm_xmltree() {
  awk '
  /^ *E: /{ i=index($0,"E:"); split($0,w," "); print "E\t" i "\t" w[2]; next }
  /^ *A: /{
    s=$0; sub(/^ *A: /,"",s); k=s; sub(/=.*/,"",k); v=s; sub(/^[^=]*=/,"",v)
    sub(/\(0x[0-9a-fA-F]+\)$/,"",k); sub(/.*[:\/]/,"",k)
    sub(/ \(Raw: .*\)$/,"",v)
    if (v ~ /^\(type 0x12\)/) { sub(/^\(type 0x12\)/,"",v); v = (v=="0x0") ? "false" : "true" }
    else sub(/^\(type 0x[0-9a-fA-F]+\)/,"",v)
    gsub(/^"|"$/,"",v)
    print "A\t" k "\t" v }'
}
# Stage 1b: apkanalyzer "manifest print" XML text -> same events
norm_xml() {
  tr '\n\r\t' '   ' | awk 'BEGIN{RS="<"; d=0}
  NR>1 {
    t=$0; sub(/>.*/,"",t)
    if (t ~ /^[?!]/) next
    if (t ~ /^\//) { d--; next }
    name=t; sub(/[ \/].*/,"",name)
    d++; print "E\t" d "\t" name
    rest=t
    while (match(rest, /[A-Za-z_][A-Za-z0-9_:.-]*="[^"]*"/)) {
      kv=substr(rest,RSTART,RLENGTH); rest=substr(rest,RSTART+RLENGTH)
      k=kv; sub(/=.*/,"",k); sub(/.*:/,"",k); v=kv; sub(/^[^=]*="/,"",v); sub(/"$/,"",v)
      print "A\t" k "\t" v }
    if (t ~ /\/[ ]*$/) d--
  }'
}
# Stage 2: events -> ATTR<TAB>elem<TAB>key<TAB>value  and  COMP<TAB>type<TAB>name<TAB>exported<TAB>nfilters<TAB>actions<TAB>schemes
norm_events() {
  awk 'BEGIN{FS="\t"; sp=0; cl=0}
  function flush() { if (cl>0) { print "COMP\t" ctype "\t" cname "\t" (cexp==""?"unset":cexp) "\t" nf "\t" acts "\t" sch; cl=0 } }
  function popto(d) { while (sp>0 && sind[sp]>=d) { if (sp==cl) flush(); sp-- } }
  $1=="E" { popto($2+0); sp++; sind[sp]=$2+0; sel[sp]=$3; par=(sp>1)?sel[sp-1]:""
    if ($3 ~ /^(activity|activity-alias|service|receiver|provider)$/ && par=="application") { cl=sp; ctype=$3; cname=""; cexp=""; nf=0; acts=""; sch="" }
    else if (cl>0 && $3=="intent-filter") nf++
    next }
  $1=="A" { e=sel[sp]; print "ATTR\t" e "\t" $2 "\t" $3
    if (cl>0) {
      if (sp==cl && $2=="name") cname=$3
      if (sp==cl && $2=="exported") cexp=$3
      if (e=="action" && $2=="name") acts=acts $3 ","
      if (e=="data" && $2=="scheme") sch=sch $3 ","
    }
    next }
  END { popto(0) }'
}

mani_attr() { # elem key -> first value
  awk -F'\t' -v e="$1" -v k="$2" '$1=="ATTR" && $2==e && $3==k {print $4; exit}' "$MANI"
}

# ---------------------------------------------------------------- checks
check_package() {
  [ "$MANI_STATE" = ok ] || return 0
  local p; p=$(mani_attr manifest package)
  if [ -z "$p" ]; then emit "package" "NOT RUN" "package attribute not found in manifest dump"
  elif [ "$p" = "$EXPECTED_PACKAGE" ]; then emit "package" PASS "package=$p"
  else emit "package" FAIL "package=$p expected $EXPECTED_PACKAGE"; fi
}
check_version() {
  [ "$MANI_STATE" = ok ] || return 0
  local v; v=$(num "$(mani_attr manifest versionCode)")
  if [ -n "$v" ]; then emit "versionCode" PASS "versionCode=$v (printed for the Play Console version-code check; EAS remote counter, ANDROID_FACTS section 2)"
  else emit "versionCode" "NOT RUN" "versionCode not found in manifest dump"; fi
}
check_sdk() {
  [ "$MANI_STATE" = ok ] || return 0
  local t c m
  t=$(num "$(mani_attr uses-sdk targetSdkVersion)"); c=$(num "$(mani_attr manifest compileSdkVersion)"); m=$(num "$(mani_attr uses-sdk minSdkVersion)")
  if [ -z "$t" ]; then emit "targetSdk>=$MIN_TARGET_SDK" "NOT RUN" "targetSdkVersion not found in manifest dump"
  elif [ "$t" -ge "$MIN_TARGET_SDK" ]; then emit "targetSdk>=$MIN_TARGET_SDK" PASS "targetSdk=$t"
  else emit "targetSdk>=$MIN_TARGET_SDK" FAIL "targetSdk=$t (Play requires API $MIN_TARGET_SDK from 31 Aug 2026, OFFICIAL_SOURCES section 6)"; fi
  if [ -z "$c" ]; then emit "compileSdk" "NOT RUN" "compileSdkVersion attribute not present in the manifest dump"
  elif [ "$c" -ge "$MIN_TARGET_SDK" ]; then emit "compileSdk" PASS "compileSdk=$c"
  else emit "compileSdk" FAIL "compileSdk=$c expected >= $MIN_TARGET_SDK"; fi
  if [ -n "$m" ]; then emit "minSdk" PASS "minSdk=$m (informational; owner confirms against the device plan: Android 12+ phones)"
  else emit "minSdk" "NOT RUN" "minSdkVersion not found in manifest dump"; fi
}
check_permissions() {
  [ "$MANI_STATE" = ok ] || return 0
  local perms p bad="" unexpected="" ok
  perms=$(awk -F'\t' '$1=="ATTR" && ($2=="uses-permission"||$2=="uses-permission-sdk-23"||$2=="uses-permission-sdk-m") && $3=="name"{print $4}' "$MANI" | sort -u)
  for p in $perms; do
    case " $FORBIDDEN_PERMS " in *" $p "*) bad="$bad $p";; esac
    case " $ALLOWED_PERMS " in *" $p "*) ;; *) case " $FORBIDDEN_PERMS " in *" $p "*) ;; *) unexpected="$unexpected $p";; esac;; esac
  done
  if [ -n "$bad" ]; then emit "permissions" FAIL "FORBIDDEN present:$bad | all: $(echo $perms)"
  elif [ -n "$unexpected" ]; then emit "permissions" FAIL "outside allowed set:$unexpected | all: $(echo $perms)"
  elif [ -z "$perms" ]; then emit "permissions" FAIL "no uses-permission found (INTERNET and location expected); manifest dump suspect"
  else emit "permissions" PASS "within allowed set: $(echo $perms)"; fi
}
check_app_flags() {
  [ "$MANI_STATE" = ok ] || return 0
  local v
  v=$(mani_attr application allowBackup)
  if [ "$v" = false ]; then emit "allowBackup=false" PASS "allowBackup=false"
  elif [ -z "$v" ]; then emit "allowBackup=false" FAIL "allowBackup not set (default true)"
  else emit "allowBackup=false" FAIL "allowBackup=$v"; fi
  v=$(mani_attr application usesCleartextTraffic)
  if [ "$v" = false ]; then emit "usesCleartextTraffic=false" PASS "usesCleartextTraffic=false"
  elif [ -z "$v" ]; then emit "usesCleartextTraffic=false" FAIL "usesCleartextTraffic not set"
  else emit "usesCleartextTraffic=false" FAIL "usesCleartextTraffic=$v"; fi
  v=$(mani_attr application dataExtractionRules)
  if [ -n "$v" ]; then emit "dataExtractionRules" PASS "android:dataExtractionRules=$v"
  else emit "dataExtractionRules" FAIL "android:dataExtractionRules absent on <application>"; fi
}
check_components() {
  if [ "$MANI_STATE" != ok ]; then return 0; fi
  if [ "$MANI_STRUCT" != yes ]; then nr_tool "exported components" "aapt2 (apkanalyzer path cannot give a reliable component tree here)"; return 0; fi
  local exported noflt n
  exported=$(awk -F'\t' '$1=="COMP"{ ex=$4; if (ex=="true" || (ex=="unset" && $5>0)) print "  " $2 " " $3 " exported=" ex " filters=" $5 " actions=[" $6 "] schemes=[" $7 "]" }' "$MANI")
  noflt=$(awk -F'\t' '$1=="COMP" && $4=="true" && $5==0 {print $2 " " $3}' "$MANI")
  n=$(printf '%s\n' "$exported" | grep -c . )
  [ -n "$exported" ] || n=0
  if [ -n "$noflt" ]; then emit "exported components" FAIL "$n exported; WITHOUT intent-filter: $(echo $noflt | tr '\n' ';')"
  else emit "exported components" PASS "$n exported, each has an intent-filter"; fi
  printf '%s\n' "$exported" | sed '/^$/d'
  local sch
  sch=$(awk -F'\t' '$1=="COMP"{print $7}' "$MANI" | tr ',' '\n' | grep -x movenrun | head -1)
  if [ -n "$sch" ]; then emit "custom scheme movenrun" PASS "intent-filter <data scheme=movenrun> present"
  else emit "custom scheme movenrun" FAIL "no intent-filter with scheme movenrun"; fi
}
check_abis() {
  [ -n "$APK" ] || return 0
  local abis
  abis=$("$T_UNZIP" -Z1 "$APK" 2>/dev/null | awk -F/ '$1=="lib" && NF>=3 {print $2}' | sort -u | tr '\n' ' ')
  case " $abis " in
    *" arm64-v8a "*) emit "ABI arm64-v8a" PASS "ABIs in lib/: $abis";;
    *) emit "ABI arm64-v8a" FAIL "ABIs in lib/: ${abis:-none}";;
  esac
}
elf_min_align() { # file -> minimum LOAD alignment in bytes, empty if unparseable
  local f=$1 vals a min=""
  if [ -n "$T_OBJDUMP" ]; then
    vals=$("$T_OBJDUMP" -p "$f" 2>/dev/null | awk '/^ *LOAD/{for(i=1;i<NF;i++) if($i=="align"){a=$(i+1); sub(/^2\*\*/,"",a); print a}}')
    for a in $vals; do a=$((1<<a)); { [ -z "$min" ] || [ "$a" -lt "$min" ]; } && min=$a; done
  else
    vals=$("$T_READELF" -lW "$f" 2>/dev/null | awk '/^ *LOAD/{print $NF}')
    for a in $vals; do a=$((a)); { [ -z "$min" ] || [ "$a" -lt "$min" ]; } && min=$a; done
  fi
  printf '%s' "$min"
}
check_16kb() {
  [ -n "$APK" ] || return 0
  if [ -z "$T_OBJDUMP" ] && [ -z "$T_READELF" ]; then nr_tool "16KB ELF LOAD alignment" "llvm-objdump or readelf"; return 0; fi
  local d="$WORK/elf" f abi m bad="" info="" n64=0 n32=0
  mkdir -p "$d"; "$T_UNZIP" -q -o "$APK" 'lib/*' -d "$d" >/dev/null 2>&1
  for f in "$d"/lib/*/*.so; do
    [ -f "$f" ] || continue
    abi=$(basename "$(dirname "$f")"); m=$(elf_min_align "$f")
    case "$abi" in
      arm64-v8a|x86_64)  # 64-bit ABIs are the Play 16 KB requirement (OFFICIAL_SOURCES section 5)
        n64=$((n64+1))
        if [ -z "$m" ]; then bad="$bad $abi/$(basename "$f")(unparseable)"
        elif [ "$m" -lt 16384 ]; then bad="$bad $abi/$(basename "$f")(align=$m)"; fi;;
      *) n32=$((n32+1)); if [ -n "$m" ] && [ "$m" -lt 16384 ]; then info="$info $abi/$(basename "$f")(align=$m)"; fi;;
    esac
  done
  if [ "$n64" -eq 0 ]; then emit "16KB ELF LOAD alignment" FAIL "no 64-bit lib/*/*.so found to inspect (32-bit libs seen: $n32)"
  elif [ -n "$bad" ]; then emit "16KB ELF LOAD alignment" FAIL "64-bit libs below 2**14:$bad"
  else emit "16KB ELF LOAD alignment" PASS "all $n64 64-bit .so LOAD segments align >= 16384 via $( [ -n "$T_OBJDUMP" ] && echo llvm-objdump -p || echo readelf -lW )${info:+ | 32-bit info only, not gating:$info}"; fi
}
check_zipalign() {
  [ -n "$APK" ] || return 0
  if [ -z "$T_ZIPALIGN" ]; then nr_tool "zipalign 16KB" zipalign; return 0; fi
  local out rc
  out=$("$T_ZIPALIGN" -c -P 16 -v 4 "$APK" 2>&1); rc=$?
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "Verification successful"; then emit "zipalign 16KB" PASS "zipalign -c -P 16 -v 4: Verification successful${KIND_NOTE}"
  else emit "zipalign 16KB" FAIL "rc=$rc: $(printf '%s' "$out" | tail -3 | tr '\n' ' ')${KIND_NOTE}"; fi
}
check_signing() {
  local out rc
  if [ "$KIND" = aab ]; then
    if [ -z "$T_KEYTOOL" ]; then nr_tool "signing cert SHA-1/SHA-256" "keytool (AAB cannot be checked by apksigner)"; return 0; fi
    out=$("$T_KEYTOOL" -printcert -jarfile "$ARTIFACT" 2>&1); rc=$?
    out=$(printf '%s\n' "$out" | grep -E '^ *(SHA1|SHA256):' | sed 's/^ *//' | tr '\n' ' ')
    if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q SHA1 && printf '%s' "$out" | grep -q SHA256; then
      emit "signing cert SHA-1/SHA-256" PASS "AAB upload-key certificate: $out (Play re-signs with the Play App Signing key; see doc)"
    else emit "signing cert SHA-1/SHA-256" FAIL "keytool rc=$rc, no certificate digests found (AAB unsigned?)"; fi
    return 0
  fi
  [ -n "$APK" ] || return 0
  if [ -z "$T_APKSIGNER" ]; then nr_tool "signing cert SHA-1/SHA-256" apksigner; return 0; fi
  out=$("$T_APKSIGNER" verify --print-certs "$APK" 2>&1); rc=$?
  local digests; digests=$(printf '%s\n' "$out" | grep -E 'certificate SHA-(1|256) digest' | sed 's/^ *//' | tr '\n' ' ')
  if [ "$rc" -eq 0 ] && printf '%s' "$digests" | grep -q 'SHA-1' && printf '%s' "$digests" | grep -q 'SHA-256'; then
    emit "signing cert SHA-1/SHA-256" PASS "$digests"
  else emit "signing cert SHA-1/SHA-256" FAIL "apksigner rc=$rc ${digests:+| $digests}$(printf '%s' "$out" | head -2 | tr '\n' ' ')"; fi
}
check_hermes() {
  [ -n "$APK" ] || return 0
  if ! "$T_UNZIP" -Z1 "$APK" 2>/dev/null | grep -qx 'assets/index.android.bundle'; then
    emit "Hermes bytecode" FAIL "assets/index.android.bundle not found"; return 0
  fi
  local head8
  head8=$( ("$T_UNZIP" -p "$APK" assets/index.android.bundle 2>/dev/null || true) | head -c 8 | od -An -tx1 | tr -d ' \n')
  if [ "$head8" = "$HERMES_MAGIC" ]; then emit "Hermes bytecode" PASS "assets/index.android.bundle starts with c6 1f bc 03 c1 03 19 1f"
  else emit "Hermes bytecode" FAIL "assets/index.android.bundle first 8 bytes=$head8 (expected $HERMES_MAGIC)"; fi
}

# ---------------------------------------------------------------- driver
inspect_artifact() { # artifact path. Prints report, returns exit code.
  ARTIFACT=$1; N_PASS=0; N_FAIL=0; N_NR=0; KIND_NOTE=""; APK=""; MANI_STATE=missing; MANI_STRUCT=no
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/movenrun-accept.XXXXXX") || { echo "NOT RUN / cannot create temp dir"; return 3; }
  MANI="$WORK/manifest.tsv"; : > "$MANI"
  resolve_tools
  echo "Artifact: $ARTIFACT"
  echo "Size: $(wc -c < "$ARTIFACT" | tr -d ' ') bytes (read-only inspection; no upload, no network, no build)"
  if [ -z "$T_UNZIP" ]; then
    nr_tool "all checks" unzip
    finish; local r=$?; rm -rf "$WORK"; return $r
  fi
  # type
  if "$T_UNZIP" -Z1 "$ARTIFACT" 2>/dev/null | grep -qx 'BundleConfig.pb'; then KIND=aab
  else case "$ARTIFACT" in *.aab) KIND=aab;; *) KIND=apk;; esac; fi
  echo "Type: $KIND"
  if [ "$KIND" = aab ]; then
    if [ -z "$T_BUNDLETOOL" ]; then
      nr_tool "AAB to universal APK" bundletool
      for c in package versionCode targetSdk compileSdk minSdk permissions allowBackup usesCleartextTraffic dataExtractionRules "exported components" "custom scheme" ABI 16KB-ELF zipalign Hermes; do nr_tool "$c" bundletool; done
      check_signing
    else
      # shellcheck disable=SC2086
      if $T_BUNDLETOOL build-apks --bundle="$ARTIFACT" --output="$WORK/out.apks" --mode=universal >"$WORK/bt.log" 2>&1 \
         && "$T_UNZIP" -p "$WORK/out.apks" universal.apk > "$WORK/universal.apk" 2>/dev/null && [ -s "$WORK/universal.apk" ]; then
        APK="$WORK/universal.apk"; KIND_NOTE=" (on bundletool universal APK derived locally from the AAB)"
        echo "Derived universal APK locally in temp dir (not signed with a release key)"
      else
        emit "AAB to universal APK" FAIL "bundletool build-apks --mode=universal failed: $(tail -2 "$WORK/bt.log" | tr '\n' ' ')"
      fi
    fi
  else APK="$ARTIFACT"; fi

  if [ -n "$APK" ]; then
    if [ -z "$T_AAPT2" ] && [ -z "$T_APKANALYZER" ]; then
      for c in package versionCode targetSdk compileSdk minSdk permissions allowBackup usesCleartextTraffic dataExtractionRules "exported components" "custom scheme"; do nr_tool "$c" "aapt2 or apkanalyzer"; done
    else
      if [ -n "$T_AAPT2" ]; then
        "$T_AAPT2" dump xmltree --file AndroidManifest.xml "$APK" 2>"$WORK/m.err" | norm_xmltree | norm_events > "$MANI"; MANI_STRUCT=yes
      else
        "$T_APKANALYZER" manifest print "$APK" 2>"$WORK/m.err" | norm_xml | norm_events > "$MANI"; MANI_STRUCT=yes
      fi
      if [ -n "$(mani_attr manifest package)" ]; then MANI_STATE=ok
      else
        MANI_STATE=bad
        for c in package versionCode targetSdk compileSdk minSdk permissions allowBackup usesCleartextTraffic dataExtractionRules "exported components" "custom scheme"; do
          emit "$c" "NOT RUN" "manifest dump unreadable or unparseable: $(head -c 160 "$WORK/m.err" | tr '\n' ' ')"
        done
      fi
    fi
    check_package; check_version; check_sdk; check_permissions; check_app_flags; check_components
    check_abis; check_16kb; check_zipalign; check_signing; check_hermes
  fi
  finish; local rc=$?
  rm -rf "$WORK"
  return $rc
}
finish() {
  echo "----"
  echo "Totals: PASS=$N_PASS FAIL=$N_FAIL NOT_RUN=$N_NR"
  if [ "$N_FAIL" -gt 0 ]; then echo "OVERALL: FAIL"; return 1
  elif [ "$N_NR" -gt 0 ]; then echo "OVERALL: INCOMPLETE (NOT RUN items present; exit 3)"; return 3
  elif [ "$N_PASS" -eq 0 ]; then echo "OVERALL: INCOMPLETE (no checks ran; exit 3)"; return 3
  else echo "OVERALL: PASS"; return 0; fi
}

self_test() {
  local d fx ok=1 out rc
  d=$(mktemp -d "${TMPDIR:-/tmp}/movenrun-selftest.XXXXXX") || { echo "SELF-TEST: cannot create temp dir"; return 4; }
  resolve_tools
  [ -n "$T_UNZIP" ] || { echo "SELF-TEST: NOT RUN / TOOL MISSING: unzip"; rm -rf "$d"; return 3; }
  command -v zip >/dev/null 2>&1 || { echo "SELF-TEST: NOT RUN / TOOL MISSING: zip (needed only to build the synthetic zip)"; rm -rf "$d"; return 3; }
  echo "SELF-TEST: synthetic zip (not a real APK) in $d"
  mkdir -p "$d/src/lib/x86" "$d/src/assets"
  printf 'not an ELF' > "$d/src/lib/x86/libfake.so"
  printf 'plain javascript, not Hermes' > "$d/src/assets/index.android.bundle"
  ( cd "$d/src" && zip -q -r "$d/synthetic.apk" lib assets )
  echo "== run 1: build-tools hidden (aapt2, apkanalyzer, zipalign, apksigner, keytool, bundletool)"
  out=$(MOVENRUN_ACCEPT_HIDE_TOOLS=aapt2,apkanalyzer,zipalign,apksigner,keytool,bundletool inspect_artifact "$d/synthetic.apk"); rc=$?
  printf '%s\n' "$out"
  [ "$rc" -eq 1 ] || { echo "SELF-TEST CHECK BROKEN: expected exit 1 (FAIL wins over NOT RUN), got $rc"; ok=0; }
  for t in "NOT RUN / TOOL MISSING: aapt2 or apkanalyzer" "NOT RUN / TOOL MISSING: zipalign" "NOT RUN / TOOL MISSING: apksigner"; do
    printf '%s\n' "$out" | grep -qF "$t" || { echo "SELF-TEST CHECK BROKEN: missing line: $t"; ok=0; }
  done
  printf '%s\n' "$out" | grep -qF "[FAIL] ABI arm64-v8a" || { echo "SELF-TEST CHECK BROKEN: ABI check should FAIL"; ok=0; }
  printf '%s\n' "$out" | grep -qF "[FAIL] Hermes bytecode" || { echo "SELF-TEST CHECK BROKEN: Hermes check should FAIL"; ok=0; }
  printf '%s\n' "$out" | grep -qE '^OVERALL: PASS' && { echo "SELF-TEST CHECK BROKEN: overall passed"; ok=0; }
  echo "== run 2: exit-code mapping of finish()"
  # Hide everything that can make a result; a zip with an empty file list still yields FAILs from unzip-only checks,
  # so assert the tool-missing contribution separately through the exit-code helper.
  N_PASS=3; N_FAIL=0; N_NR=1; out=$(finish); rc=$?
  [ "$rc" -eq 3 ] && ! printf '%s' "$out" | grep -q '^OVERALL: PASS' || { echo "SELF-TEST CHECK BROKEN: NOT RUN did not force exit 3"; ok=0; }
  N_PASS=3; N_FAIL=0; N_NR=0; out=$(finish); rc=$?
  [ "$rc" -eq 0 ] || { echo "SELF-TEST CHECK BROKEN: all-pass should give 0"; ok=0; }
  echo "== run 3: manifest parser on a hand-written aapt2-style fixture (NOT real aapt2 output)"
  fx="$d/fixture.txt"
  cat > "$fx" <<'FIX'
N: android=http://schemas.android.com/apk/res/android
  E: manifest (line=2)
    A: package="io.movenrun.app" (Raw: "io.movenrun.app")
    A: http://schemas.android.com/apk/res/android:versionCode(0x0101021b)=7
    E: uses-sdk (line=7)
      A: http://schemas.android.com/apk/res/android:minSdkVersion(0x0101020c)=24
      A: http://schemas.android.com/apk/res/android:targetSdkVersion(0x01010270)=36
    E: uses-permission (line=9)
      A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.permission.INTERNET" (Raw: "android.permission.INTERNET")
    E: application (line=12)
      A: http://schemas.android.com/apk/res/android:allowBackup(0x01010280)=(type 0x12)0x0
      E: activity (line=20)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)=".MainActivity" (Raw: ".MainActivity")
        A: http://schemas.android.com/apk/res/android:exported(0x01010010)=(type 0x12)0xffffffff
        E: intent-filter (line=24)
          E: action (line=25)
            A: http://schemas.android.com/apk/res/android:name(0x01010003)="android.intent.action.VIEW" (Raw: "x")
          E: data (line=28)
            A: http://schemas.android.com/apk/res/android:scheme(0x01010027)="movenrun" (Raw: "movenrun")
      E: service (line=40)
        A: http://schemas.android.com/apk/res/android:name(0x01010003)=".Svc" (Raw: ".Svc")
        A: http://schemas.android.com/apk/res/android:exported(0x01010010)=(type 0x12)0xffffffff
FIX
  out=$(norm_xmltree < "$fx" | norm_events)
  printf '%s\n' "$out" | grep -qF $'ATTR\tmanifest\tpackage\tio.movenrun.app' || { echo "SELF-TEST PARSER BROKEN: package"; ok=0; }
  printf '%s\n' "$out" | grep -qF $'ATTR\tapplication\tallowBackup\tfalse' || { echo "SELF-TEST PARSER BROKEN: allowBackup"; ok=0; }
  printf '%s\n' "$out" | grep -qF $'COMP\tactivity\t.MainActivity\ttrue\t1\tandroid.intent.action.VIEW,\tmovenrun,' || { echo "SELF-TEST PARSER BROKEN: activity component"; ok=0; }
  printf '%s\n' "$out" | grep -qF $'COMP\tservice\t.Svc\ttrue\t0' || { echo "SELF-TEST PARSER BROKEN: exported service without filter"; ok=0; }
  rm -rf "$d"
  if [ "$ok" -eq 1 ]; then
    echo "SELF-TEST DISCIPLINE: verified (tool-missing is NOT RUN, FAIL beats NOT RUN, NOT RUN forces exit 3). A synthetic zip can never pass, so this mode never exits 0."
    return 3
  fi
  echo "SELF-TEST DISCIPLINE: BROKEN"
  return 4
}

main() {
  if [ "${1:-}" = "--self-test" ]; then self_test; exit $?; fi
  if [ $# -lt 1 ] || [ -z "${1:-}" ]; then
    echo "NOT RUN / ARTIFACT MISSING: pass the path of an existing owner-supplied .apk or .aab (or use --self-test)"
    echo "Usage: $0 /path/to/app.apk|app.aab"
    exit 2
  fi
  if [ ! -f "$1" ]; then
    echo "NOT RUN / ARTIFACT MISSING: no such file: $1"
    exit 2
  fi
  inspect_artifact "$1"; exit $?
}
main "$@"
