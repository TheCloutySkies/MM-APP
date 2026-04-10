import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useEffect, useState, type ReactNode } from "react";
import {
    Alert,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    useColorScheme,
    useWindowDimensions,
} from "react-native";

import { InfoHint } from "@/components/chrome/InfoHint";
import Colors from "@/constants/Colors";
import { TacticalPalette } from "@/constants/TacticalTheme";
import { base64ToBytes, bytesToBase64, hexToBytes, utf8, utf8decode } from "@/lib/crypto/bytes";
import { idbDel, idbGet, idbSet } from "@/lib/signals/idb";
import { aesGcmDecryptTextFromBundle, aesGcmEncryptTextToBundle, randomBytes } from "@/lib/signals/subtle";
import { vigenereDecrypt, vigenereEncrypt } from "@/lib/signals/vigenere";
import {
    exportPrivateKeyPkcs8,
    exportPublicKeySpkiB64,
    generateWhisperKeypair,
    importPrivateKeyPkcs8,
    whisperDecrypt,
    whisperEncrypt,
} from "@/lib/signals/whisper";
import { useMMStore } from "@/store/mmStore";

type Mode = "encode" | "decode";

type SignalTabId =
  | "aes"
  | "whisper"
  | "otp"
  | "compressor"
  | "stego"
  | "legacy";

/**
 * Ordering: least → most secure (approximate).
 * Compressor / legacy are not strong confidentiality; OTP assumes ideal random, single-use pads.
 */
type ModeMenuItem = { rank: number; tab: SignalTabId; title: string; subtitle: string };

const ENCODE_OPERATIONS: ModeMenuItem[] = [
  {
    rank: 1,
    tab: "legacy",
    title: "Field encodings",
    subtitle: "Morse, Vigenère, Base64, Hex — obfuscation / format only",
  },
  {
    rank: 2,
    tab: "compressor",
    title: "Radio / mesh compressor",
    subtitle: "Brevity & shortening — not encryption",
  },
  {
    rank: 3,
    tab: "stego",
    title: "Steganography (LSB)",
    subtitle: "Hide ciphertext in an image (web)",
  },
  {
    rank: 4,
    tab: "aes",
    title: "AES-256-GCM",
    subtitle: "Passphrase + authenticated ciphertext (JSON bundle)",
  },
  {
    rank: 5,
    tab: "whisper",
    title: "Whisper (ECDH)",
    subtitle: "Asymmetric; derive shared key, AES-GCM payload",
  },
  {
    rank: 6,
    tab: "otp",
    title: "One-time pad",
    subtitle: "Generate random A–Z pad — strongest if pad is single-use",
  },
];

/** Decode-capable tools only (same security order where applicable). */
const DECODE_OPERATIONS: ModeMenuItem[] = [
  {
    rank: 1,
    tab: "legacy",
    title: "Field encodings",
    subtitle: "Decode Morse, Vigenère, Base64, Hex",
  },
  {
    rank: 2,
    tab: "stego",
    title: "Steganography (LSB)",
    subtitle: "Extract hidden text (web)",
  },
  {
    rank: 3,
    tab: "aes",
    title: "AES-256-GCM",
    subtitle: "Decrypt JSON bundle with passphrase",
  },
  {
    rank: 4,
    tab: "whisper",
    title: "Whisper (ECDH)",
    subtitle: "Decrypt envelope with your private key",
  },
];

type MethodBlurb = { title: string; how: string; goodFor: string; security: string };

/** Plain reference copy when Encode/Decode menus are closed. */
const METHODS_AT_A_GLANCE: MethodBlurb[] = [
  {
    title: "Field encodings",
    how: "Morse maps letters to a dot-dash pattern. Vigenère applies the classical tabula-recta letter shifts with a repeating keyword (encrypt adds key, decrypt subtracts). Base64 and hex turn raw bytes into text you can paste anywhere.",
    goodFor: "Voice readbacks, cutting noise on busy text channels, moving small payloads through tools that hate binary.",
    security: "Low. This is classical ciphers and formats, not modern secrecy. Count on traffic analysis and guessing if an adversary gets the ciphertext.",
  },
  {
    title: "Radio and mesh compressor",
    how: "Swaps long phrases for brevity codewords, strips filler words, optionally drops vowels from longer words, and can rewrite decimal lat/lng into an MGRS grid.",
    goodFor: "LoRa, mesh, or HF when you care about byte count and time on air more than polish.",
    security: "None for confidentiality. It only shrinks text. If the text is sensitive, encrypt it with something real, then compress if you still need length.",
  },
  {
    title: "Steganography",
    how: "Writes your message into the least significant bits of an image so the picture still looks normal to the eye.",
    goodFor: "When you need the file to look innocent crossing a checkpoint or inbox filter.",
    security: "Hiding is not the same as locking. Forensics tools can flag LSB tampering. Encrypt first, then hide, if the payload matters.",
  },
  {
    title: "AES-256-GCM",
    how: "Your passphrase feeds PBKDF2, which outputs a 256-bit key. AES-GCM encrypts the bytes and produces an authentication tag so flipped bits fail decrypt.",
    goodFor: "Teams that already share a strong passphrase out of band and want copy-paste JSON between phones or radios.",
    security: "High when the passphrase is long, random, and never reused across unrelated groups. Weak if the phrase is short, reused, or written on a whiteboard.",
  },
  {
    title: "Whisper (ECDH)",
    how: "Each operator keeps a private key and hands out a public key. To send, you mix your private key with the recipient public key, derive a shared secret, and run AES-GCM on the message.",
    goodFor: "Groups that outgrow one shared password and need pairwise or roster-based messaging without passing the master secret on the wire.",
    security: "High if keys stay on device and you verify fingerprints in person or on a trusted channel. Lose the private key and older ciphertext is gone for you. Wrong public key means you encrypt for the wrong person.",
  },
  {
    title: "One-time pad",
    how: "You generate a random pad at least as long as the message and combine pad and text with modular math. The pad burns after use.",
    goodFor: "Paper-first workflows, air-gapped prep, or any time you will manage physical custody of random material.",
    security: "Matches the quality of your random source and your discipline. Random must be unbiased, pad never reused, pad kept as secret as the message. Slip once and the whole model collapses.",
  },
];

const MONO_FONT = Platform.OS === "ios" ? "Menlo" : "monospace";

function byteCountUtf8(s: string): number {
  return utf8(s).length;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function useQuickGuide(tab: SignalTabId, mode: Mode): { title: string; body: string } {
  switch (tab) {
    case "aes":
      return {
        title: "AES-256-GCM (symmetric)",
        body:
          [
            "Mechanics:",
            "- PBKDF2-SHA256 derives a 256-bit AES key from your passphrase + random salt.",
            "- AES-GCM encrypts and authenticates (integrity) using a random 96-bit IV.",
            "",
            "Copy format:",
            "- Output is JSON containing { saltB64, ivB64, ctB64, iter }.",
            "- Receiver needs the same passphrase + the JSON bundle to decrypt.",
            "",
            "Use-cases:",
            "- Off-grid copy/paste between teammates (chat, radio relay, paper transcription).",
            "- Low bandwidth: keep plaintext short; ciphertext expands due to base64 + tag.",
            "",
            "Failure modes:",
            "- Wrong passphrase or any modified byte → decrypt fails (auth tag).",
          ].join("\n"),
      };
    case "whisper":
      return {
        title: "Asymmetric (Whisper) — ECDH",
        body:
          [
            "Mechanics:",
            "- Each operator has an ECDH keypair (P-384): public key shareable, private key secret.",
            "- Sender combines their private key with recipient public key to derive a shared secret.",
            "- That shared secret becomes an AES-256-GCM key to encrypt the message.",
            "",
            "Critical property:",
            "- Only the matching private key can decrypt messages to that operator.",
            "",
            "Operational use:",
            "- Share public keys once (group roster). Whisper messages are copy/paste JSON envelopes.",
            "",
            "Rules:",
            "- If you lose your private key you lose access to past whispers.",
            "- Verify public keys out-of-band (QR, paper, in-person) to avoid impersonation.",
          ].join("\n"),
      };
    case "otp":
      return {
        title: "One-Time Pad (Analog)",
        body:
          [
            "Mechanics:",
            "- OTP is information-theoretically secure if: truly random pad, used once, same length as message.",
            "- This generator uses crypto.getRandomValues() to create A–Z pads in 5-letter groups.",
            "",
            "Rules (non-negotiable):",
            "- NEVER reuse a pad (or any segment). Reuse breaks OTP and leaks plaintext relationships.",
            "- Keep pads physically secure; burn after use; track page/line usage.",
            "",
            "Use-cases:",
            "- Low-tech, offline, no devices. Works with paper codebooks.",
          ].join("\n"),
      };
    case "compressor":
      return {
        title: "Radio/Mesh Compressor",
        body:
          [
            "Goal:",
            "- Shrink plaintext for constrained links (LoRa ~220 bytes, HF radio brevity, relays).",
            "",
            "Tools:",
            "- Brevity expansion: MEDEVAC, LZ, SITREP, grid/coords normalization.",
            "- Vowel stripping for non-critical words (readability trade-off).",
            "- Lat/Lng → MGRS for compact tactical coordinates.",
            "",
            "Rule of thumb:",
            "- Shorter messages transmit faster, jam less, and have higher delivery probability.",
          ].join("\n"),
      };
    case "stego":
      return {
        title: "LSB Steganography (image)",
        body:
          [
            "Mechanics:",
            "- Encodes message bits into the least-significant bits of RGB pixels in a PNG.",
            "- Visually subtle but NOT cryptography: treat as concealment, not security.",
            "",
            "Rule:",
            "- Always encrypt first (AES/Whisper) then hide the ciphertext.",
            "",
            "Constraints:",
            "- Web-only (uses HTML canvas). JPEG carriers are discouraged (lossy).",
          ].join("\n"),
      };
    case "legacy":
      return {
        title: "Field encodings & legacy ciphers",
        body:
          [
            "Purpose:",
            "- Interop with radios, legacy workflows, and quick obfuscation (NOT strong crypto).",
            "",
            "Included:",
            "- Morse encode/decode + optional tone on web.",
            "- Standard repeating-keyword Vigenère (Latin A–Z tabula recta) — real classical cipher, not a hash/XOR substitute.",
            "- Base64 and Hex utilities for moving binary-ish data over text channels.",
          ].join("\n"),
      };
    default:
      return { title: "Quick Guide", body: "" };
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function MethodsAtAGlancePanel(props: {
  textColor: string;
  mutedColor: string;
  borderColor: string;
  tint: string;
  onTintLabel: string;
  onClose: () => void;
}) {
  return (
    <View style={styles.methodsAtAGlanceWrap}>
      <ScrollView
        style={[styles.methodsAtAGlanceScroll, { flex: 1, minHeight: 0 }]}
        contentContainerStyle={styles.methodsAtAGlanceContent}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled">
        <Text style={[styles.methodsAtAGlanceHead, { color: props.textColor }]}>Methods at a glance</Text>
        <Text style={[styles.methodsAtAGlanceSub, { color: props.mutedColor }]}>
          Plain comparison of each option. Nothing here leaves your browser.
        </Text>
        {METHODS_AT_A_GLANCE.map((m) => (
          <View key={m.title} style={[styles.methodBlurbBlock, { borderColor: props.borderColor }]}>
            <Text style={[styles.methodBlurbTitle, { color: props.textColor }]}>{m.title}</Text>
            <Text style={[styles.methodBlurbLead, { color: props.textColor }]}>How it works</Text>
            <Text style={[styles.methodBlurbBody, { color: props.mutedColor }]}>{m.how}</Text>
            <Text style={[styles.methodBlurbLead, { color: props.textColor, marginTop: 8 }]}>Good for</Text>
            <Text style={[styles.methodBlurbBody, { color: props.mutedColor }]}>{m.goodFor}</Text>
            <Text style={[styles.methodBlurbLead, { color: props.textColor, marginTop: 8 }]}>Security</Text>
            <Text style={[styles.methodBlurbBody, { color: props.mutedColor }]}>{m.security}</Text>
          </View>
        ))}
        <Pressable
          onPress={props.onClose}
          style={[styles.primaryBtn, { backgroundColor: props.tint, marginTop: 14 }]}
          accessibilityRole="button"
          accessibilityLabel="Back to tool workspace">
          <Text style={[styles.primaryBtnTx, { color: props.onTintLabel }]}>Back to tool</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

export default function SignalsScreen() {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const { width, height } = useWindowDimensions();
  const desktopSplit = Platform.OS === "web" && width >= 980;
  const guideMaxH = Math.min(360, Math.round(height * 0.44));

  const [mode, setMode] = useState<Mode>("encode");
  const [tab, setTab] = useState<SignalTabId>("aes");
  const [guideOpen, setGuideOpen] = useState(desktopSplit);
  const [encodeMenuOpen, setEncodeMenuOpen] = useState(false);
  const [decodeMenuOpen, setDecodeMenuOpen] = useState(false);
  /** When true, show only the method reference. Never stack reference + tool UI. */
  const [methodReferenceOpen, setMethodReferenceOpen] = useState(false);

  const guide = useQuickGuide(tab, mode);
  const onTintLabel = scheme === "dark" ? "#0f172a" : "#ffffff";

  /** OTP + compressor are encode-oriented in this UI. */
  useEffect(() => {
    if ((tab === "otp" || tab === "compressor") && mode === "decode") {
      setMode("encode");
    }
  }, [tab, mode]);

  const closeModeMenus = () => {
    setEncodeMenuOpen(false);
    setDecodeMenuOpen(false);
  };

  const pickEncode = (nextTab: SignalTabId) => {
    setTab(nextTab);
    setMode("encode");
    setMethodReferenceOpen(false);
    closeModeMenus();
  };

  const pickDecode = (nextTab: SignalTabId) => {
    setTab(nextTab);
    setMode("decode");
    setMethodReferenceOpen(false);
    closeModeMenus();
  };

  const openCiphersHelpMenu = () => {
    closeModeMenus();
    Alert.alert(
      "Ciphers help",
      "Open a full method comparison or the detailed guide for the tool you selected.",
      [
        {
          text: "Method comparison",
          onPress: () => {
            setMethodReferenceOpen(true);
            setGuideOpen(false);
          },
        },
        {
          text: "Quick guide (this tool)",
          onPress: () => {
            setMethodReferenceOpen(false);
            setGuideOpen(true);
          },
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
  };

  const paneStyle = desktopSplit ? styles.splitRow : styles.splitCol;
  const opPaneStyle = desktopSplit ? styles.leftPane : styles.topPane;
  const guidePaneStyle = desktopSplit ? styles.rightPane : styles.bottomPane;
  const stackedGuide = !desktopSplit && guideOpen;

  return (
    <View style={[styles.screen, { backgroundColor: p.background }]}>
      {(encodeMenuOpen || decodeMenuOpen) && (
        <Pressable
          accessibilityLabel="Close menu"
          onPress={closeModeMenus}
          style={styles.modeMenuBackdrop}
        />
      )}
      <View style={[styles.head, { borderBottomColor: TacticalPalette.border }]}>
        <View style={styles.headTitleRow}>
          <Text style={[styles.h1, { color: p.text }]}>Ciphers</Text>
          <InfoHint
            title="Ciphers"
            webTitle="Client-side only. Use the help menu on phones for long reference text."
            message="All processing stays on-device. Use Encode/Decode to pick a method; open Help on small screens for the full comparison and per-tool guide."
            tint={p.tabIconDefault}
          />
        </View>
        <Text style={[styles.sub, { color: p.tabIconDefault }]}>Client-side tools — copy/paste bundles off-grid.</Text>
      </View>

      <View style={[styles.modeMenuBar, { borderBottomColor: TacticalPalette.border }]}>
        <View style={styles.modeAnchor}>
          <Pressable
            onPress={() => {
              setDecodeMenuOpen(false);
              setEncodeMenuOpen((v) => !v);
            }}
            style={[
              styles.modeBtn,
              mode === "encode" && { borderColor: p.tint, backgroundColor: TacticalPalette.panel },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Encode or encrypt — choose method"
            accessibilityState={{ expanded: encodeMenuOpen, selected: mode === "encode" }}>
            <View style={styles.modeBtnInner}>
              <Text style={[styles.modeTx, { color: p.text }]}>Encode / Encrypt</Text>
              <FontAwesome name={encodeMenuOpen ? "caret-up" : "caret-down"} size={12} color={p.tabIconDefault} />
            </View>
          </Pressable>
          {encodeMenuOpen ? (
            <View
              style={[
                styles.modeDropdown,
                {
                  borderColor: TacticalPalette.border,
                  backgroundColor: TacticalPalette.elevated,
                  ...(Platform.OS === "web"
                    ? ({ boxShadow: "0 16px 40px rgba(0,0,0,0.5)" } as const)
                    : { elevation: 14 }),
                },
              ]}>
              <Text style={[styles.modeDropdownIntro, { color: p.tabIconDefault }]}>
                Least → most secure (approx.)
              </Text>
              <ScrollView style={styles.modeDropdownScroll} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                {ENCODE_OPERATIONS.map((item) => {
                  const sel = tab === item.tab && mode === "encode";
                  return (
                    <Pressable
                      key={item.tab}
                      onPress={() => pickEncode(item.tab)}
                      style={[
                        styles.modeDropdownRow,
                        { borderBottomColor: TacticalPalette.border },
                        sel && { backgroundColor: TacticalPalette.panel },
                      ]}
                      accessibilityRole="menuitem">
                      <Text style={[styles.modeRank, { color: p.tabIconDefault }]}>{item.rank}.</Text>
                      <View style={styles.modeDropdownTextCol}>
                        <Text style={[styles.modeDropdownTitle, { color: p.text }]}>{item.title}</Text>
                        <Text style={[styles.modeDropdownSub, { color: p.tabIconDefault }]}>{item.subtitle}</Text>
                      </View>
                      {sel ? <FontAwesome name="check" size={14} color={p.tint} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
        </View>

        <View style={styles.modeAnchor}>
          <Pressable
            onPress={() => {
              setEncodeMenuOpen(false);
              setDecodeMenuOpen((v) => !v);
            }}
            style={[
              styles.modeBtn,
              mode === "decode" && { borderColor: p.tint, backgroundColor: TacticalPalette.panel },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Decode or decrypt — choose method"
            accessibilityState={{ expanded: decodeMenuOpen, selected: mode === "decode" }}>
            <View style={styles.modeBtnInner}>
              <Text style={[styles.modeTx, { color: p.text }]}>Decode / Decrypt</Text>
              <FontAwesome name={decodeMenuOpen ? "caret-up" : "caret-down"} size={12} color={p.tabIconDefault} />
            </View>
          </Pressable>
          {decodeMenuOpen ? (
            <View
              style={[
                styles.modeDropdown,
                {
                  borderColor: TacticalPalette.border,
                  backgroundColor: TacticalPalette.elevated,
                  ...(Platform.OS === "web"
                    ? ({ boxShadow: "0 16px 40px rgba(0,0,0,0.5)" } as const)
                    : { elevation: 14 }),
                },
              ]}>
              <Text style={[styles.modeDropdownIntro, { color: p.tabIconDefault }]}>
                Least → most secure (approx.)
              </Text>
              <ScrollView style={styles.modeDropdownScroll} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                {DECODE_OPERATIONS.map((item) => {
                  const sel = tab === item.tab && mode === "decode";
                  return (
                    <Pressable
                      key={item.tab}
                      onPress={() => pickDecode(item.tab)}
                      style={[
                        styles.modeDropdownRow,
                        { borderBottomColor: TacticalPalette.border },
                        sel && { backgroundColor: TacticalPalette.panel },
                      ]}
                      accessibilityRole="menuitem">
                      <Text style={[styles.modeRank, { color: p.tabIconDefault }]}>{item.rank}.</Text>
                      <View style={styles.modeDropdownTextCol}>
                        <Text style={[styles.modeDropdownTitle, { color: p.text }]}>{item.title}</Text>
                        <Text style={[styles.modeDropdownSub, { color: p.tabIconDefault }]}>{item.subtitle}</Text>
                      </View>
                      {sel ? <FontAwesome name="check" size={14} color={p.tint} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Text style={[styles.modeDropdownFoot, { color: p.tabIconDefault }]}>
                Compressor & OTP: use Encode menu only.
              </Text>
            </View>
          ) : null}
        </View>

        {desktopSplit ? (
          <>
            <Pressable
              onPress={() => {
                closeModeMenus();
                if (methodReferenceOpen) {
                  setMethodReferenceOpen(false);
                } else {
                  setMethodReferenceOpen(true);
                  setGuideOpen(false);
                }
              }}
              style={[
                styles.guideToggle,
                { borderColor: methodReferenceOpen ? p.tint : p.tabIconDefault },
              ]}
              accessibilityLabel={methodReferenceOpen ? "Close method reference" : "Open method reference"}>
              <Text
                style={[styles.guideToggleTx, { color: methodReferenceOpen ? p.tint : p.tabIconDefault }]}>
                {methodReferenceOpen ? "Tool" : "Reference"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                closeModeMenus();
                if (methodReferenceOpen) setMethodReferenceOpen(false);
                setGuideOpen((v) => !v);
              }}
              style={[
                styles.guideToggle,
                { borderColor: guideOpen ? p.tint : p.tabIconDefault },
              ]}
              accessibilityLabel={guideOpen ? "Hide quick guide" : "Show quick guide"}>
              <Text style={[styles.guideToggleTx, { color: guideOpen ? p.tint : p.tabIconDefault }]}>
                {guideOpen ? "Hide guide" : "Quick guide"}
              </Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={openCiphersHelpMenu}
            style={[styles.guideToggle, { borderColor: p.tabIconDefault, flexDirection: "row", gap: 8 }]}
            accessibilityLabel="Open ciphers help and reference">
            <FontAwesome name="info-circle" size={14} color={p.tint} />
            <Text style={[styles.guideToggleTx, { color: p.text }]}>Help</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.mainWorkspace}>
        {methodReferenceOpen ? (
          <MethodsAtAGlancePanel
            textColor={p.text}
            mutedColor={p.tabIconDefault}
            borderColor={TacticalPalette.border}
            tint={p.tint}
            onTintLabel={onTintLabel}
            onClose={() => setMethodReferenceOpen(false)}
          />
        ) : (
          <View style={[paneStyle, styles.workspacePane]}>
            <View
              style={[
                opPaneStyle,
                {
                  borderRightColor: TacticalPalette.border,
                  borderBottomColor: TacticalPalette.border,
                  minHeight: stackedGuide ? 140 : 0,
                  flex: 1,
                  flexShrink: 1,
                },
              ]}>
              {tab === "aes" ? <AesPane mode={mode} /> : null}
              {tab === "whisper" ? <WhisperPane mode={mode} /> : null}
              {tab === "otp" ? <OtpPane /> : null}
              {tab === "compressor" ? <CompressorPane /> : null}
              {tab === "stego" ? <StegoPane mode={mode} /> : null}
              {tab === "legacy" ? <LegacyPane mode={mode} /> : null}
            </View>

            {guideOpen ? (
              <View
                style={[
                  guidePaneStyle,
                  desktopSplit ? null : { minHeight: 0, maxHeight: guideMaxH, flexGrow: 0, flexShrink: 1 },
                ]}>
                <View style={[styles.guideHead, { borderBottomColor: TacticalPalette.border }]}>
                  <Text style={[styles.guideTitle, { color: p.text }]}>{guide.title}</Text>
                </View>
                <ScrollView
                  style={{ flex: 1, minHeight: 0 }}
                  contentContainerStyle={styles.guideBody}
                  keyboardShouldPersistTaps="handled">
                  <Text style={[styles.guideText, { color: p.tabIconDefault }]}>{guide.body}</Text>
                </ScrollView>
              </View>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}

function AesPane({ mode }: { mode: Mode }) {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const [pass, setPass] = useState("");
  const [plain, setPlain] = useState("");
  const [bundle, setBundle] = useState("");
  const [out, setOut] = useState("");

  return (
    <ScrollView
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={styles.panePad}
      keyboardShouldPersistTaps="handled">
      <Text style={[styles.paneTitle, { color: p.text }]}>AES-256-GCM</Text>
      <Text style={[styles.paneHint, { color: p.tabIconDefault }]}>
        Passphrase → PBKDF2 key → AES-GCM. Output is copy/paste JSON.
      </Text>

      <Section title="Secret passphrase">
        <TextInput
          value={pass}
          onChangeText={setPass}
          placeholder="Passphrase"
          placeholderTextColor="#888"
          secureTextEntry
          style={[styles.input, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.elevated }]}
        />
      </Section>

      {mode === "encode" ? (
        <>
          <Section title="Plaintext">
            <TextInput
              value={plain}
              onChangeText={setPlain}
              placeholder="Message to encrypt…"
              placeholderTextColor="#888"
              multiline
              style={[styles.textArea, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.elevated }]}
            />
          </Section>
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: p.tint }]}
            onPress={async () => {
              try {
                if (!pass.trim()) throw new Error("Passphrase required.");
                const b = await aesGcmEncryptTextToBundle({ passphrase: pass, plaintext: plain });
                setBundle(JSON.stringify(b));
                setOut("");
              } catch (e) {
                Alert.alert("AES", e instanceof Error ? e.message : "Failed");
              }
            }}>
            <Text style={[styles.primaryBtnTx, { color: scheme === "dark" ? "#0f172a" : "#fff" }]}>Encrypt</Text>
          </Pressable>
          <Section title="Copy bundle (JSON)">
            <TextInput
              value={bundle}
              onChangeText={setBundle}
              multiline
              style={[styles.monoArea, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.charcoal, fontFamily: MONO_FONT }]}
            />
          </Section>
        </>
      ) : (
        <>
          <Section title="Paste bundle (JSON)">
            <TextInput
              value={bundle}
              onChangeText={setBundle}
              placeholder='{"v":1,"saltB64":"...","ivB64":"...","ctB64":"..."}'
              placeholderTextColor="#888"
              multiline
              style={[styles.monoArea, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.charcoal, fontFamily: MONO_FONT }]}
            />
          </Section>
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: p.tint }]}
            onPress={async () => {
              try {
                if (!pass.trim()) throw new Error("Passphrase required.");
                const pt = await aesGcmDecryptTextFromBundle({ passphrase: pass, bundleJson: bundle });
                setOut(pt);
              } catch (e) {
                Alert.alert("AES", e instanceof Error ? e.message : "Decrypt failed");
              }
            }}>
            <Text style={[styles.primaryBtnTx, { color: scheme === "dark" ? "#0f172a" : "#fff" }]}>Decrypt</Text>
          </Pressable>
          <Section title="Plaintext output">
            <TextInput
              value={out}
              onChangeText={setOut}
              multiline
              style={[styles.textArea, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.elevated, fontFamily: MONO_FONT }]}
            />
          </Section>
        </>
      )}
    </ScrollView>
  );
}

type StoredWhisperPriv = {
  v: 1;
  ivB64: string;
  ctB64: string;
};

const WHISPER_PRIV_KEY_IDB_KEY = "whisper_priv_p384_v1";
const WHISPER_PRIV_AAD = "mm-signals-whisper-priv-v1";

async function aesGcmEncryptWithRawKey(key32: Uint8Array, plaintext: Uint8Array, aad: string): Promise<StoredWhisperPriv> {
  const subtle = globalThis.crypto.subtle;
  const iv = randomBytes(12);
  const keyBuf = key32.buffer.slice(key32.byteOffset, key32.byteOffset + key32.byteLength) as ArrayBuffer;
  const ivBuf = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const ptBuf = plaintext.buffer.slice(plaintext.byteOffset, plaintext.byteOffset + plaintext.byteLength) as ArrayBuffer;
  const aadU8 = utf8(aad);
  const aadBuf = aadU8.buffer.slice(aadU8.byteOffset, aadU8.byteOffset + aadU8.byteLength) as ArrayBuffer;
  const key = await subtle.importKey("raw", keyBuf, { name: "AES-GCM" }, false, ["encrypt"]);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv: ivBuf, additionalData: aadBuf }, key, ptBuf);
  return { v: 1, ivB64: bytesToBase64(iv), ctB64: bytesToBase64(new Uint8Array(ct)) };
}

async function aesGcmDecryptWithRawKey(key32: Uint8Array, stored: StoredWhisperPriv, aad: string): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  const iv = base64ToBytes(stored.ivB64);
  const ct = base64ToBytes(stored.ctB64);
  const keyBuf = key32.buffer.slice(key32.byteOffset, key32.byteOffset + key32.byteLength) as ArrayBuffer;
  const ivBuf = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const ctBuf = ct.buffer.slice(ct.byteOffset, ct.byteOffset + ct.byteLength) as ArrayBuffer;
  const aadU8 = utf8(aad);
  const aadBuf = aadU8.buffer.slice(aadU8.byteOffset, aadU8.byteOffset + aadU8.byteLength) as ArrayBuffer;
  const key = await subtle.importKey("raw", keyBuf, { name: "AES-GCM" }, false, ["decrypt"]);
  try {
    const pt = await subtle.decrypt({ name: "AES-GCM", iv: ivBuf, additionalData: aadBuf }, key, ctBuf);
    return new Uint8Array(pt);
  } catch {
    throw new Error("Cannot unlock stored private key (wrong PIN/vault partition).");
  }
}

function WhisperPane({ mode }: { mode: Mode }) {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const username = useMMStore((s) => s.username);
  const vaultMode = useMMStore((s) => s.vaultMode);
  const mainKey = useMMStore((s) => s.mainVaultKey);
  const decoyKey = useMMStore((s) => s.decoyVaultKey);

  const activeKey = vaultMode === "main" ? mainKey : vaultMode === "decoy" ? decoyKey : null;

  const [myPub, setMyPub] = useState("");
  const [peerPub, setPeerPub] = useState("");
  const [plain, setPlain] = useState("");
  const [envelope, setEnvelope] = useState("");
  const [out, setOut] = useState("");

  const canUse = Platform.OS === "web" && !!activeKey && activeKey.length === 32;

  const loadMyKey = async (): Promise<CryptoKeyPair> => {
    if (!activeKey || activeKey.length !== 32) throw new Error("Unlock your vault (main/decoy) to access your whisper key.");
    const stored = await idbGet<StoredWhisperPriv>(WHISPER_PRIV_KEY_IDB_KEY);
    if (!stored) throw new Error("No private key stored. Generate one first.");
    const pkcs8 = await aesGcmDecryptWithRawKey(activeKey, stored, WHISPER_PRIV_AAD);
    const priv = await importPrivateKeyPkcs8(pkcs8);
    // Public key is derived from stored local export on demand by requiring the user to copy it out.
    // We keep only the private in IndexedDB for simplicity; user can regenerate if needed.
    // For encryption we also need a public key: generate ephemeral keypair for sender side each message.
    return { privateKey: priv, publicKey: (await generateWhisperKeypair()).publicKey };
  };

  return (
    <ScrollView
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={styles.panePad}
      keyboardShouldPersistTaps="handled">
      <Text style={[styles.paneTitle, { color: p.text }]}>Asymmetric (Whisper)</Text>
      <Text style={[styles.paneHint, { color: p.tabIconDefault }]}>
        ECDH P-384 derives a shared secret, then AES-256-GCM encrypts. Private key is stored in IndexedDB encrypted by your
        active vault key.
      </Text>

      {Platform.OS !== "web" ? (
        <View style={[styles.warnBox, { borderColor: TacticalPalette.accent }]}>
          <Text style={[styles.warnText, { color: p.text }]}>
            Whisper is currently enabled on web builds (uses IndexedDB). Native support can be added next.
          </Text>
        </View>
      ) : null}

      {!canUse ? (
        <View style={[styles.warnBox, { borderColor: TacticalPalette.accent }]}>
          <Text style={[styles.warnText, { color: p.text }]}>
            Unlock your vault (main/decoy) to generate/store your Whisper private key.
          </Text>
        </View>
      ) : null}

      <Section title="Your keypair">
        <View style={styles.rowWrap}>
          <Pressable
            style={[styles.smallBtn, { borderColor: p.tint }]}
            onPress={async () => {
              try {
                if (!activeKey || activeKey.length !== 32) throw new Error("Unlock your vault first.");
                const kp = await generateWhisperKeypair();
                const pubB64 = await exportPublicKeySpkiB64(kp.publicKey);
                const pkcs8 = await exportPrivateKeyPkcs8(kp.privateKey);
                const enc = await aesGcmEncryptWithRawKey(activeKey, pkcs8, WHISPER_PRIV_AAD);
                await idbSet(WHISPER_PRIV_KEY_IDB_KEY, enc);
                setMyPub(pubB64);
                Alert.alert("Whisper", "Keypair generated. Share your public key with teammates.");
              } catch (e) {
                Alert.alert("Whisper", e instanceof Error ? e.message : "Failed");
              }
            }}>
            <Text style={[styles.smallBtnTx, { color: p.tint }]}>Generate keypair</Text>
          </Pressable>
          <Pressable
            style={[styles.smallBtn, { borderColor: TacticalPalette.danger }]}
            onPress={async () => {
              await idbDel(WHISPER_PRIV_KEY_IDB_KEY);
              setMyPub("");
              Alert.alert("Whisper", "Stored private key deleted.");
            }}>
            <Text style={[styles.smallBtnTx, { color: TacticalPalette.danger }]}>Delete private key</Text>
          </Pressable>
        </View>
        <TextInput
          value={myPub}
          onChangeText={setMyPub}
          placeholder="Your public key (SPKI Base64)…"
          placeholderTextColor="#888"
          multiline
          style={[styles.monoArea, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.charcoal, fontFamily: MONO_FONT }]}
        />
        <Text style={[styles.micro, { color: p.tabIconDefault }]}>
          Share this public key with the team roster. Private key stays local (encrypted).
        </Text>
      </Section>

      {mode === "encode" ? (
        <>
          <Section title="Teammate public key (Base64)">
            <TextInput
              value={peerPub}
              onChangeText={setPeerPub}
              placeholder="Paste teammate public key…"
              placeholderTextColor="#888"
              multiline
              style={[styles.monoArea, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.charcoal, fontFamily: MONO_FONT }]}
            />
          </Section>
          <Section title="Message">
            <TextInput
              value={plain}
              onChangeText={setPlain}
              placeholder={`Whisper from ${username ?? "operator"}…`}
              placeholderTextColor="#888"
              multiline
              style={[styles.textArea, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.elevated, fontFamily: MONO_FONT }]}
            />
          </Section>
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: p.tint }]}
            onPress={async () => {
              try {
                if (!peerPub.trim()) throw new Error("Teammate public key required.");
                // Use stored private key for identity; use ephemeral pub for sender pub in envelope.
                const kp = await loadMyKey();
                const env = await whisperEncrypt({
                  myPrivateKey: kp.privateKey,
                  myPublicKey: kp.publicKey,
                  peerPublicKeySpkiB64: peerPub,
                  plaintextUtf8: plain,
                });
                setEnvelope(JSON.stringify(env));
              } catch (e) {
                Alert.alert("Whisper", e instanceof Error ? e.message : "Encrypt failed");
              }
            }}>
            <Text style={[styles.primaryBtnTx, { color: scheme === "dark" ? "#0f172a" : "#fff" }]}>Encrypt whisper</Text>
          </Pressable>
          <Section title="Copy envelope (JSON)">
            <TextInput
              value={envelope}
              onChangeText={setEnvelope}
              multiline
              style={[styles.monoArea, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.charcoal, fontFamily: MONO_FONT }]}
            />
          </Section>
        </>
      ) : (
        <>
          <Section title="Paste envelope (JSON)">
            <TextInput
              value={envelope}
              onChangeText={setEnvelope}
              placeholder='{"v":1,"senderPubSpkiB64":"...","ivB64":"...","ctB64":"..."}'
              placeholderTextColor="#888"
              multiline
              style={[styles.monoArea, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.charcoal, fontFamily: MONO_FONT }]}
            />
          </Section>
          <Pressable
            style={[styles.primaryBtn, { backgroundColor: p.tint }]}
            onPress={async () => {
              try {
                const kp = await loadMyKey();
                const pt = await whisperDecrypt({ myPrivateKey: kp.privateKey, envelopeJson: envelope });
                setOut(pt);
              } catch (e) {
                Alert.alert("Whisper", e instanceof Error ? e.message : "Decrypt failed");
              }
            }}>
            <Text style={[styles.primaryBtnTx, { color: scheme === "dark" ? "#0f172a" : "#fff" }]}>Decrypt whisper</Text>
          </Pressable>
          <Section title="Plaintext output">
            <TextInput
              value={out}
              onChangeText={setOut}
              multiline
              style={[styles.textArea, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.elevated, fontFamily: MONO_FONT }]}
            />
          </Section>
        </>
      )}
    </ScrollView>
  );
}

function OtpPane() {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const [blocks, setBlocks] = useState(40);
  const [pad, setPad] = useState<string[]>([]);

  const gen = () => {
    const n = clamp(blocks, 1, 400);
    const bytes = randomBytes(n * 5);
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      let s = "";
      for (let j = 0; j < 5; j++) {
        const b = bytes[i * 5 + j]!;
        s += String.fromCharCode(65 + (b % 26));
      }
      out.push(s);
    }
    setPad(out);
  };

  const burn = () => {
    setPad([]);
  };

  return (
    <ScrollView
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={styles.panePad}
      keyboardShouldPersistTaps="handled">
      <Text style={[styles.paneTitle, { color: p.text }]}>One-Time Pad (Analog)</Text>
      <Text style={[styles.paneHint, { color: p.tabIconDefault }]}>
        Generates A–Z pads in 5-letter groups using crypto.getRandomValues(). Print and store physically. Never reuse.
      </Text>

      <Section title="Blocks (5 letters each)">
        <TextInput
          value={String(blocks)}
          onChangeText={(t) => setBlocks(Number(t.replace(/[^\d]/g, "")) || 0)}
          keyboardType="numeric"
          style={[styles.input, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.elevated, fontFamily: MONO_FONT }]}
        />
      </Section>
      <View style={styles.rowWrap}>
        <Pressable style={[styles.primaryBtn, { backgroundColor: p.tint, flex: 1 }]} onPress={gen}>
          <Text style={[styles.primaryBtnTx, { color: scheme === "dark" ? "#0f172a" : "#fff" }]}>Generate</Text>
        </Pressable>
        <Pressable style={[styles.primaryBtn, { backgroundColor: TacticalPalette.danger, flex: 1 }]} onPress={burn}>
          <Text style={[styles.primaryBtnTx, { color: "#0f172a" }]}>Burn</Text>
        </Pressable>
      </View>

      {pad.length ? (
        <View style={[styles.otpSheet, { borderColor: TacticalPalette.border }]}>
          <Text style={[styles.otpHead, { color: p.text }]}>OTP pad (print)</Text>
          <View style={styles.otpGrid}>
            {pad.map((b, i) => (
              <Text key={i} style={[styles.otpCell, { color: p.text, fontFamily: MONO_FONT }]}>
                {b}
              </Text>
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function compressBrevity(input: string): string {
  const dict: Record<string, string> = {
    "need medical evacuation": "MEDEVAC",
    "medical evacuation": "MEDEVAC",
    "enemy in area": "ENY AO",
    "situation report": "SITREP",
    "after action report": "AAR",
    "landing zone": "LZ",
    "rally point": "RP",
    "grid reference": "GRID",
    "ammunition": "AMMO",
    "water": "WTR",
  };
  let s = input.trim();
  const lower = s.toLowerCase();
  for (const [k, v] of Object.entries(dict)) {
    if (lower.includes(k)) {
      const re = new RegExp(k, "gi");
      s = s.replace(re, v);
    }
  }
  // Remove filler words
  s = s.replace(/\b(the|a|an|and|or|to|of|for|please|now)\b/gi, "").replace(/\s+/g, " ").trim();
  return s;
}

function stripVowelsSelective(input: string): string {
  const words = input.split(/\s+/);
  return words
    .map((w) => {
      if (w.length <= 4) return w;
      if (/^[A-Z0-9_-]+$/.test(w)) return w; // already compact
      return w.replace(/[aeiou]/gi, "");
    })
    .join(" ");
}

function CompressorPane() {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const [src, setSrc] = useState("");
  const [out, setOut] = useState("");
  const [useVowelStrip, setUseVowelStrip] = useState(true);
  const [useMGRS, setUseMGRS] = useState(true);

  const bytes = byteCountUtf8(out);
  const over = bytes > 220;

  const run = async () => {
    let s = compressBrevity(src);
    if (useVowelStrip) s = stripVowelsSelective(s);
    if (useMGRS) {
      // Replace patterns like: "lat 34.12 lng -117.21" or "(34.12, -117.21)" with MGRS
      const re = /(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/g;
      const matches = [...s.matchAll(re)];
      if (matches.length) {
        const m = await import("mgrs");
        s = s.replace(re, (_, latS, lngS) => {
          const lat = Number(latS);
          const lng = Number(lngS);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return _;
          try {
            // mgrs.forward expects [lon, lat]
            return String((m as any).forward([lng, lat], 5));
          } catch {
            return _;
          }
        });
      }
    }
    setOut(s);
  };

  return (
    <ScrollView
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={styles.panePad}
      keyboardShouldPersistTaps="handled">
      <Text style={[styles.paneTitle, { color: p.text }]}>Radio / Mesh Compressor</Text>
      <Text style={[styles.paneHint, { color: p.tabIconDefault }]}>
        Shrinks plain English for constrained links. Meter turns red above 220 bytes.
      </Text>

      <Section title="Input">
        <TextInput
          value={src}
          onChangeText={setSrc}
          placeholder="Need Medical Evacuation at 34.1234, -117.2345…"
          placeholderTextColor="#888"
          multiline
          style={[styles.textArea, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.elevated }]}
        />
      </Section>

      <View style={styles.rowWrap}>
        <Pressable
          style={[styles.smallBtn, { borderColor: useVowelStrip ? p.tint : TacticalPalette.border }]}
          onPress={() => setUseVowelStrip((v) => !v)}>
          <Text style={[styles.smallBtnTx, { color: p.text }]}>Vowel strip {useVowelStrip ? "ON" : "off"}</Text>
        </Pressable>
        <Pressable
          style={[styles.smallBtn, { borderColor: useMGRS ? p.tint : TacticalPalette.border }]}
          onPress={() => setUseMGRS((v) => !v)}>
          <Text style={[styles.smallBtnTx, { color: p.text }]}>MGRS {useMGRS ? "ON" : "off"}</Text>
        </Pressable>
      </View>

      <Pressable style={[styles.primaryBtn, { backgroundColor: p.tint }]} onPress={() => void run()}>
        <Text style={[styles.primaryBtnTx, { color: scheme === "dark" ? "#0f172a" : "#fff" }]}>Convert</Text>
      </Pressable>

      <Section title="Output (send this)">
        <View style={[styles.meterRow, { borderColor: over ? TacticalPalette.danger : TacticalPalette.border }]}>
          <Text style={[styles.meterTx, { color: over ? TacticalPalette.danger : p.tabIconDefault }]}>
            {bytes} bytes {over ? "— too long" : "— ok"}
          </Text>
        </View>
        <TextInput
          value={out}
          onChangeText={setOut}
          multiline
          style={[styles.monoArea, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.charcoal, fontFamily: MONO_FONT }]}
        />
      </Section>
    </ScrollView>
  );
}

function StegoPane({ mode }: { mode: Mode }) {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const [msg, setMsg] = useState("");
  const [decoded, setDecoded] = useState("");

  if (Platform.OS !== "web") {
    return (
      <View style={[styles.panePad, { gap: 12 }]}>
        <Text style={[styles.paneTitle, { color: p.text }]}>Steganography</Text>
        <Text style={[styles.warnText, { color: p.tabIconDefault }]}>
          Canvas-based stego is web-only right now. Encrypt first, then hide the ciphertext.
        </Text>
      </View>
    );
  }

  const readFile = async (file: File): Promise<HTMLImageElement> => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("Image load failed"));
    });
    URL.revokeObjectURL(url);
    return img;
  };

  const bitsFromBytes = (b: Uint8Array): number[] => {
    const out: number[] = [];
    for (const x of b) for (let i = 7; i >= 0; i--) out.push((x >> i) & 1);
    return out;
  };
  const bytesFromBits = (bits: number[]): Uint8Array => {
    const n = Math.floor(bits.length / 8);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | (bits[i * 8 + j] ?? 0);
      out[i] = v;
    }
    return out;
  };

  const encode = async (file: File) => {
    const img = await readFile(file);
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = id.data;
    const payload = utf8(msg);
    const len = payload.length >>> 0;
    const lenBytes = new Uint8Array([len >>> 24, len >>> 16, len >>> 8, len]);
    const bits = [...bitsFromBytes(lenBytes), ...bitsFromBytes(payload)];
    const capacity = Math.floor((data.length / 4) * 3); // 3 channels per pixel
    if (bits.length > capacity) throw new Error("Message too large for this image.");
    let bi = 0;
    for (let i = 0; i < data.length && bi < bits.length; i += 4) {
      for (let c = 0; c < 3 && bi < bits.length; c++) {
        data[i + c] = (data[i + c]! & 0xfe) | bits[bi]!;
        bi++;
      }
    }
    ctx.putImageData(id, 0, 0);
    const outUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = outUrl;
    a.download = "stego.png";
    a.click();
  };

  const decode = async (file: File) => {
    const img = await readFile(file);
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(img, 0, 0);
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = id.data;
    const bits: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      bits.push(data[i]! & 1, data[i + 1]! & 1, data[i + 2]! & 1);
    }
    const lenBytes = bytesFromBits(bits.slice(0, 32));
    const len = ((lenBytes[0]! << 24) | (lenBytes[1]! << 16) | (lenBytes[2]! << 8) | lenBytes[3]!) >>> 0;
    const msgBits = bits.slice(32, 32 + len * 8);
    const msgBytes = bytesFromBits(msgBits);
    setDecoded(utf8decode(msgBytes));
  };

  const FilePicker = ({ onPick }: { onPick: (f: File) => void }) => (
    <input
      type="file"
      accept="image/png,image/jpeg,image/webp"
      onChange={(e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) onPick(f);
      }}
      style={{ marginTop: 8, marginBottom: 10 }}
    />
  );

  return (
    <ScrollView
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={styles.panePad}
      keyboardShouldPersistTaps="handled">
      <Text style={[styles.paneTitle, { color: p.text }]}>Steganography (LSB)</Text>
      <Text style={[styles.paneHint, { color: p.tabIconDefault }]}>
        Conceal text inside a PNG’s RGB least-significant bits. Not a substitute for encryption.
      </Text>

      {mode === "encode" ? (
        <>
          <Section title="Secret message (encrypt first)">
            <TextInput
              value={msg}
              onChangeText={setMsg}
              multiline
              placeholderTextColor="#888"
              style={[styles.textArea, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.elevated, fontFamily: MONO_FONT }]}
            />
          </Section>
          <Section title="Carrier image → output stego.png">
            <FilePicker
              onPick={(f) => {
                void encode(f).catch((e) => Alert.alert("Stego", e instanceof Error ? e.message : "Failed"));
              }}
            />
          </Section>
        </>
      ) : (
        <>
          <Section title="Upload image to decode">
            <FilePicker
              onPick={(f) => {
                void decode(f).catch((e) => Alert.alert("Stego", e instanceof Error ? e.message : "Failed"));
              }}
            />
          </Section>
          <Section title="Decoded text">
            <TextInput
              value={decoded}
              onChangeText={setDecoded}
              multiline
              style={[styles.textArea, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.elevated, fontFamily: MONO_FONT }]}
            />
          </Section>
        </>
      )}
    </ScrollView>
  );
}

const MORSE: Record<string, string> = {
  a: ".-",
  b: "-...",
  c: "-.-.",
  d: "-..",
  e: ".",
  f: "..-.",
  g: "--.",
  h: "....",
  i: "..",
  j: ".---",
  k: "-.-",
  l: ".-..",
  m: "--",
  n: "-.",
  o: "---",
  p: ".--.",
  q: "--.-",
  r: ".-.",
  s: "...",
  t: "-",
  u: "..-",
  v: "...-",
  w: ".--",
  x: "-..-",
  y: "-.--",
  z: "--..",
  "1": ".----",
  "2": "..---",
  "3": "...--",
  "4": "....-",
  "5": ".....",
  "6": "-....",
  "7": "--...",
  "8": "---..",
  "9": "----.",
  "0": "-----",
  ".": ".-.-.-",
  ",": "--..--",
  "?": "..--..",
  "/": "-..-.",
  "-": "-....-",
  "(": "-.--.",
  ")": "-.--.-",
};

function morseEncode(s: string): string {
  return s
    .toLowerCase()
    .split("")
    .map((ch) => (ch === " " ? "/" : MORSE[ch] ?? ""))
    .filter((x) => x !== "")
    .join(" ");
}

function morseDecode(s: string): string {
  const inv: Record<string, string> = {};
  for (const [k, v] of Object.entries(MORSE)) inv[v] = k;
  return s
    .trim()
    .split(/\s+/)
    .map((tok) => (tok === "/" ? " " : inv[tok] ?? ""))
    .join("");
}

function LegacyPane({ mode }: { mode: Mode }) {
  const scheme = useColorScheme() ?? "light";
  const p = Colors[scheme];
  const [src, setSrc] = useState("");
  const [key, setKey] = useState("");
  const [out, setOut] = useState("");
  const [legacyTab, setLegacyTab] = useState<"morse" | "vigenere" | "b64" | "hex">("morse");

  const run = () => {
    try {
      if (legacyTab === "morse") {
        setOut(mode === "encode" ? morseEncode(src) : morseDecode(src));
        return;
      }
      if (legacyTab === "vigenere") {
        if (!key.trim()) throw new Error("Keyword required.");
        setOut(mode === "encode" ? vigenereEncrypt(src, key) : vigenereDecrypt(src, key));
        return;
      }
      if (legacyTab === "b64") {
        setOut(mode === "encode" ? bytesToBase64(utf8(src)) : utf8decode(base64ToBytes(src.trim())));
        return;
      }
      if (legacyTab === "hex") {
        setOut(
          mode === "encode"
            ? Array.from(utf8(src), (b) => b.toString(16).padStart(2, "0")).join("")
            : utf8decode(hexToBytes(src.trim())),
        );
      }
    } catch (e) {
      Alert.alert("Ciphers", e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={styles.panePad}
      keyboardShouldPersistTaps="handled">
      <Text style={[styles.paneTitle, { color: p.text }]}>Field encodings</Text>
      <View style={styles.rowWrap}>
        {[
          ["morse", "Morse"],
          ["vigenere", "Vigenère"],
          ["b64", "Base64"],
          ["hex", "Hex"],
        ].map(([id, label]) => (
          <Pressable
            key={id}
            onPress={() => setLegacyTab(id as any)}
            style={[
              styles.smallBtn,
              { borderColor: legacyTab === id ? p.tint : TacticalPalette.border, backgroundColor: "transparent" },
            ]}>
            <Text style={[styles.smallBtnTx, { color: p.text }]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {legacyTab === "vigenere" ? (
        <TextInput
          value={key}
          onChangeText={setKey}
          placeholder="Keyword"
          placeholderTextColor="#888"
          style={[styles.input, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.elevated, fontFamily: MONO_FONT }]}
        />
      ) : null}

      <Section title="Input">
        <TextInput
          value={src}
          onChangeText={setSrc}
          multiline
          placeholderTextColor="#888"
          style={[styles.textArea, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.elevated, fontFamily: MONO_FONT }]}
        />
      </Section>

      <Pressable style={[styles.primaryBtn, { backgroundColor: p.tint }]} onPress={run}>
        <Text style={[styles.primaryBtnTx, { color: scheme === "dark" ? "#0f172a" : "#fff" }]}>
          {mode === "encode" ? "Encode" : "Decode"}
        </Text>
      </Pressable>

      <Section title="Output">
        <TextInput
          value={out}
          onChangeText={setOut}
          multiline
          style={[styles.monoArea, { color: p.text, borderColor: TacticalPalette.border, backgroundColor: TacticalPalette.charcoal, fontFamily: MONO_FONT }]}
        />
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, position: "relative" as const },
  modeMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    backgroundColor: "transparent",
  },
  modeMenuBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 3,
    position: "relative" as const,
  },
  modeAnchor: {
    flex: 1,
    minWidth: 0,
    position: "relative" as const,
    zIndex: 4,
  },
  modeBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  modeDropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: 360,
    overflow: "hidden",
  },
  modeDropdownIntro: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.55,
    textTransform: "uppercase",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
  },
  modeDropdownScroll: { maxHeight: 268 },
  modeDropdownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modeRank: { fontSize: 12, fontWeight: "900", width: 24 },
  modeDropdownTextCol: { flex: 1, minWidth: 0 },
  modeDropdownTitle: { fontSize: 14, fontWeight: "800" },
  modeDropdownSub: { fontSize: 11, lineHeight: 15, marginTop: 3 },
  modeDropdownFoot: {
    fontSize: 10,
    lineHeight: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontStyle: "italic",
  },
  head: { padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, zIndex: 2 },
  headTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  h1: { fontSize: 22, fontWeight: "800" },
  sub: { marginTop: 4, fontSize: 12, lineHeight: 16 },
  mainWorkspace: { flex: 1, minHeight: 0 },
  workspacePane: { flex: 1, minHeight: 0, zIndex: 0 },
  methodsAtAGlanceWrap: {
    flex: 1,
    minHeight: 0,
    position: "relative" as const,
  },
  methodsAtAGlanceScroll: { flex: 1 },
  methodsAtAGlanceContent: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 },
  methodsAtAGlanceHead: { fontSize: 13, fontWeight: "800", marginBottom: 4 },
  methodsAtAGlanceSub: { fontSize: 11, lineHeight: 15, marginBottom: 10 },
  methodBlurbBlock: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  methodBlurbTitle: { fontSize: 15, fontWeight: "800", marginBottom: 8 },
  methodBlurbLead: { fontSize: 11, fontWeight: "800", letterSpacing: 0.35, marginBottom: 3 },
  methodBlurbBody: { fontSize: 12, lineHeight: 18 },
  modeBtn: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    borderColor: TacticalPalette.border,
  },
  modeTx: { fontWeight: "800" },
  guideToggle: { borderWidth: 1, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12 },
  guideToggleTx: { fontWeight: "800", fontSize: 12 },

  splitRow: { flex: 1, flexDirection: "row", minHeight: 0 },
  splitCol: { flex: 1, flexDirection: "column", minHeight: 0 },
  leftPane: { flex: 1, minHeight: 0, borderRightWidth: StyleSheet.hairlineWidth },
  rightPane: {
    width: 420,
    maxWidth: "40%",
    minHeight: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: TacticalPalette.border,
  },
  topPane: { flex: 1, minHeight: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  bottomPane: { flex: 1, minHeight: 0 },

  guideHead: { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  guideTitle: { fontSize: 14, fontWeight: "800" },
  guideBody: { padding: 12, paddingBottom: 28 },
  guideText: { fontSize: 12, lineHeight: 18, fontFamily: MONO_FONT as any },

  panePad: { padding: 14, paddingBottom: 60, gap: 8 },
  paneTitle: { fontSize: 18, fontWeight: "800" },
  paneHint: { fontSize: 12, lineHeight: 17, marginBottom: 6 },
  sectionTitle: { color: TacticalPalette.coyote, fontSize: 11, fontWeight: "800", letterSpacing: 0.6, marginBottom: 6 },

  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14 },
  textArea: { borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 110, textAlignVertical: "top", fontSize: 14, lineHeight: 20 },
  monoArea: { borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 120, textAlignVertical: "top", fontSize: 12, lineHeight: 17 },
  primaryBtn: { paddingVertical: 14, borderRadius: 12, alignItems: "center", marginTop: 6 },
  primaryBtnTx: { fontSize: 15, fontWeight: "900" },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" },
  smallBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  smallBtnTx: { fontSize: 13, fontWeight: "800" },
  warnBox: { borderWidth: 1, borderRadius: 10, padding: 12, backgroundColor: "rgba(107, 142, 92, 0.12)" },
  warnText: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  micro: { fontSize: 11, marginTop: 6 },

  otpSheet: { borderWidth: 1, borderRadius: 12, padding: 12, backgroundColor: "#ffffff", marginTop: 10 },
  otpHead: { fontSize: 12, fontWeight: "900", marginBottom: 8 },
  otpGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  otpCell: { color: "#000", fontSize: 14, letterSpacing: 1.2, paddingVertical: 2, paddingHorizontal: 4, borderWidth: 1, borderColor: "#000" },

  meterRow: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 8 },
  meterTx: { fontSize: 12, fontWeight: "900" },
});

