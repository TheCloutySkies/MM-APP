import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFocusEffect } from "@react-navigation/native";
import * as Location from "expo-location";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    type ViewStyle,
    useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TacticalPalette } from "@/constants/TacticalTheme";
import {
    deriveKeyForPinAndRoute,
    eventsTable,
    fetchEncryptedEvents,
    flushCalendarSyncQueue,
    pushNewEvent,
    resolveCalendarPinRoute,
    tryDecryptRow,
} from "@/lib/calendar/calendarApi";
import { offlineGetEvent, offlineListEventIds } from "@/lib/calendar/calendarOffline";
import { clearCalendarSession, getCalendarSessionKey, setCalendarSessionKey } from "@/lib/calendar/calendarSession";
import {
    CALENDAR_EVENT_TYPES,
    type CalendarEventPlain,
    type CalendarEventType,
} from "@/lib/calendar/calendarTypes";
import { ensureMmCalendarSession } from "@/lib/calendar/ensureMmCalendarSession";
import { SK, secureSet } from "@/lib/secure/mmSecureStore";
import { fetchCalendarProfileRow } from "@/lib/supabase/calendarProfile";
import { useMMStore } from "@/store/mmStore";

/** Fixed keypad button size — avoids SSR/client `useWindowDimensions` mismatch (React #418). */
const PIN_PAD_KEY_W = 72;
const PIN_PAD_KEY_H = 40;

function monthMatrix(viewMonth: Date): (number | null)[][] {
  const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const startPad = first.getDay();
  const dim = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

function sameDay(a: Date, d: number, m: Date): boolean {
  return a.getFullYear() === m.getFullYear() && a.getMonth() === m.getMonth() && a.getDate() === d;
}

export function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const hydrated = useMMStore((s) => s.hydrated);
  const supabase = useMMStore((s) => s.supabase);
  const profileId = useMMStore((s) => s.profileId);

  const [phase, setPhase] = useState<"pin" | "app">("pin");
  const [pinText, setPinText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [calMode, setCalMode] = useState<"real" | "decoy" | null>(null);
  const [viewMonth, setViewMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => new Date().getDate());
  const [events, setEvents] = useState<{ rowId: string; plain: CalendarEventPlain }[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [evtType, setEvtType] = useState<CalendarEventType>("Patrol");
  const [locLabel, setLocLabel] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [startIso, setStartIso] = useState("");
  const [endIso, setEndIso] = useState("");
  const [description, setDescription] = useState("");

  const selectedDate = useMemo(
    () => new Date(viewMonth.getFullYear(), viewMonth.getMonth(), selectedDay),
    [viewMonth, selectedDay],
  );

  const reloadForMode = useCallback(async (mode: "real" | "decoy") => {
    const key = getCalendarSessionKey();
    const { profileId: pid, supabase: sb } = useMMStore.getState();
    if (!key || !pid) return;
    const rows = await fetchEncryptedEvents(sb, mode);
    const next: { rowId: string; plain: CalendarEventPlain }[] = [];
    for (const r of rows) {
      const dec = tryDecryptRow(key, r.id, r.author_id, r.encrypted_payload);
      if (dec) next.push({ rowId: dec.rowId, plain: dec.plain });
    }
    const have = new Set(next.map((e) => e.rowId));
    const ids = await offlineListEventIds(mode);
    for (const id of ids) {
      if (have.has(id)) continue;
      const plain = await offlineGetEvent(mode, id);
      if (plain) next.push({ rowId: id, plain });
    }
    setEvents(next);
  }, []);

  useFocusEffect(
    useCallback(() => {
      clearCalendarSession();
      setPhase("pin");
      setPinText("");
      setPinError(null);
      setCalMode(null);
      setEvents([]);
      setFormOpen(false);
      return () => {
        clearCalendarSession();
        setPhase("pin");
        setPinText("");
        setCalMode(null);
        setEvents([]);
      };
    }, []),
  );

  useEffect(() => {
    void ensureMmCalendarSession();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    if (phase !== "app") return;
    const prev = document.body.style.overscrollBehavior;
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overscrollBehavior = prev;
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "app" || !supabase || !profileId || !calMode) return;
    void flushCalendarSyncQueue(supabase, profileId).then(() => reloadForMode(calMode));
  }, [phase, supabase, profileId, calMode, reloadForMode]);

  useEffect(() => {
    if (phase !== "app" || !supabase || !calMode) return;
    const table = eventsTable(calMode);
    const ch = supabase
      .channel(`mm-cal-${table}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, () => {
        if (calMode) void reloadForMode(calMode);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [phase, supabase, calMode, reloadForMode]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const on = () => {
      if (phase === "app" && supabase && profileId && calMode) {
        void flushCalendarSyncQueue(supabase, profileId).then(() => reloadForMode(calMode));
      }
    };
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [phase, supabase, profileId, calMode, reloadForMode]);

  const onSubmitPin = async () => {
    if (pinText.length < 4) {
      setPinError("Enter a valid PIN.");
      return;
    }
    const { profileId: pid, supabase: sb } = await ensureMmCalendarSession();
    if (!pid) {
      setPinError("Not signed in. Open another tab and sign in, then try again.");
      return;
    }
    setBusy(true);
    setPinError(null);
    const pinThis = pinText;
    try {
      const { data: prof, error: pErr } = sb ? await fetchCalendarProfileRow(sb, pid) : { data: null, error: null };
      if (pErr) throw pErr;
      const route = await resolveCalendarPinRoute(pinThis, prof);
      if (route === "invalid") {
        setPinError("Invalid PIN.");
        setBusy(false);
        return;
      }
      if (prof?.calendar_salt_primary) await secureSet(SK.calendarSaltPrimary, prof.calendar_salt_primary);
      if (prof?.calendar_salt_duress) await secureSet(SK.calendarSaltDuress, prof.calendar_salt_duress);
      const key = await deriveKeyForPinAndRoute(pinThis, route, prof);
      setPinText("");
      if (!key) {
        setPinError("Calendar keys unavailable. Try online once to sync profile.");
        setBusy(false);
        return;
      }
      setCalendarSessionKey(key, route);
      setCalMode(route);
      setPhase("app");
      void reloadForMode(route);
    } catch (e) {
      setPinError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const dayEvents = events.filter((e) => {
    const t = new Date(e.plain.startIso);
    return sameDay(t, selectedDay, viewMonth);
  });

  const matrix = useMemo(() => monthMatrix(viewMonth), [viewMonth]);

  const openNewForm = () => {
    const now = new Date();
    setStartIso(now.toISOString().slice(0, 16));
    setEndIso(new Date(now.getTime() + 3600_000).toISOString().slice(0, 16));
    setDescription("");
    setLocLabel("");
    setLat(null);
    setLng(null);
    setEvtType("Patrol");
    setFormOpen(true);
  };

  const useGps = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Location", "Permission denied.");
      return;
    }
    const pos = await Location.getCurrentPositionAsync({});
    setLat(pos.coords.latitude);
    setLng(pos.coords.longitude);
    setLocLabel(`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`);
  };

  const saveEvent = async () => {
    const key = getCalendarSessionKey();
    const { profileId: pid, supabase: sb } = useMMStore.getState();
    if (!key || !calMode) {
      Alert.alert("Calendar", "Session expired. Lock and unlock the calendar with your PIN.");
      return;
    }
    if (!pid) {
      Alert.alert("Calendar", "Not signed in. Open the app and sign in, then try again.");
      return;
    }
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      Alert.alert("Calendar", "Start and end must be valid dates.");
      return;
    }
    if (end.getTime() < start.getTime()) {
      Alert.alert("Calendar", "End time must be after start.");
      return;
    }
    const plain: CalendarEventPlain = {
      v: 1,
      type: evtType,
      locationLabel: locLabel || undefined,
      lat: lat ?? undefined,
      lng: lng ?? undefined,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      description,
    };
    const { error } = await pushNewEvent(sb, pid, calMode, key, plain);
    if (error) {
      Alert.alert(
        "Calendar",
        `${error}\n\nIf you are offline, the event was queued on this device and will sync when connected.`,
      );
    }
    setFormOpen(false);
    await reloadForMode(calMode);
  };

  const cellSizeApp = Math.min(44, Math.floor((width - 32) / 7));

  if (!hydrated) {
    return (
      <View
        style={[
          styles.shell,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, justifyContent: "center" },
        ]}>
        <ActivityIndicator size="large" color={TacticalPalette.coyote} />
        <Text style={[styles.sub, { textAlign: "center", marginTop: 16 }]}>Restoring session…</Text>
      </View>
    );
  }

  if (phase === "pin") {
    return (
      <View style={[styles.shell, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.hdr}>Secure calendar</Text>
        <Text style={styles.sub}>
          Enter your numeric PIN (type below or use the keypad). Routing is verified on-device; keys are wiped when you
          leave this tab.
        </Text>
        {pinError ? <Text style={styles.err}>{pinError}</Text> : null}
        <TextInput
          value={pinText}
          onChangeText={(t) => setPinText(t.replace(/\D/g, "").slice(0, 12))}
          keyboardType={Platform.OS === "web" ? "default" : "number-pad"}
          secureTextEntry
          textContentType="password"
          autoComplete="off"
          autoCorrect={false}
          autoCapitalize="none"
          importantForAutofill="no"
          placeholder="PIN"
          placeholderTextColor={TacticalPalette.boneMuted}
          style={styles.pinInput}
          editable={!busy}
          onSubmitEditing={() => void onSubmitPin()}
          returnKeyType="done"
        />
        <View style={styles.pad}>
          {(
            [
              { id: "1", k: "1" },
              { id: "2", k: "2" },
              { id: "3", k: "3" },
              { id: "4", k: "4" },
              { id: "5", k: "5" },
              { id: "6", k: "6" },
              { id: "7", k: "7" },
              { id: "8", k: "8" },
              { id: "9", k: "9" },
              { id: "sp", k: "" },
              { id: "0", k: "0" },
              { id: "del", k: "del" },
            ] as const
          ).map(({ id, k }) => (
            <Pressable
              key={id}
              disabled={k === "" || busy}
              onPress={() => {
                if (k === "del") setPinText((p) => p.slice(0, -1));
                else if (k) setPinText((p) => (p.length < 12 ? p + k : p));
              }}
              style={[styles.key, { width: PIN_PAD_KEY_W, height: PIN_PAD_KEY_H }, k === "" && styles.keyGhost]}>
              {k === "del" ? (
                <Text style={styles.keyTx}>{"\u232b"}</Text>
              ) : k ? (
                <Text style={styles.keyTx}>{k}</Text>
              ) : null}
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void onSubmitPin()}
          style={({ pressed }) => [styles.unlockBtn, pressed && { opacity: 0.85 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.unlockTx}>Unlock</Text>}
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.shellApp,
        Platform.OS === "web"
          ? ({ height: "100dvh", maxHeight: "100dvh" } as unknown as ViewStyle)
          : { flex: 1 },
        { paddingTop: insets.top + 4, paddingBottom: insets.bottom + 72 },
      ]}>
      <View style={styles.topBar}>
        <Text style={styles.hdrSm}>
          Calendar {calMode === "decoy" ? "(alternate)" : ""}
        </Text>
        <Text style={styles.monthNavTx}>
          {viewMonth.toLocaleString(undefined, { month: "long", year: "numeric" })}
        </Text>
        <View style={styles.monthNav}>
          <Pressable onPress={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}>
            <FontAwesome name="chevron-left" size={18} color={TacticalPalette.coyote} />
          </Pressable>
          <Pressable onPress={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}>
            <FontAwesome name="chevron-right" size={18} color={TacticalPalette.coyote} />
          </Pressable>
        </View>
      </View>

      <View style={styles.weekRow}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <Text key={`${d}-${i}`} style={[styles.weekCell, { width: cellSizeApp }]}>
            {d}
          </Text>
        ))}
      </View>
      {matrix.map((row, ri) => (
        <View key={ri} style={styles.weekRow}>
          {row.map((d, ci) => (
            <Pressable
              key={ci}
              disabled={d == null}
              onPress={() => d != null && setSelectedDay(d)}
              style={[
                styles.dayCell,
                { width: cellSizeApp, minHeight: cellSizeApp },
                d === selectedDay && styles.daySelected,
              ]}>
              <Text style={[styles.dayTx, d == null && { opacity: 0 }]}>{d ?? ""}</Text>
            </Pressable>
          ))}
        </View>
      ))}

      <Text style={styles.dayHdr}>
        {selectedDate.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
      </Text>
      <ScrollView style={styles.list} contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}>
        {dayEvents.length === 0 ? (
          <Text style={styles.empty}>No events this day.</Text>
        ) : (
          dayEvents.map((ev) => (
            <View key={ev.rowId} style={styles.card}>
              <Text style={styles.cardTitle}>{ev.plain.type}</Text>
              <Text style={styles.cardMeta}>
                {new Date(ev.plain.startIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} —{" "}
                {new Date(ev.plain.endIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </Text>
              {ev.plain.locationLabel ? <Text style={styles.cardMeta}>{ev.plain.locationLabel}</Text> : null}
              <Text style={styles.cardBody}>{ev.plain.description}</Text>
            </View>
          ))
        )}
      </ScrollView>

      <Pressable accessibilityRole="button" style={[styles.fab, { bottom: insets.bottom + 16 }]} onPress={openNewForm}>
        <FontAwesome name="plus" size={24} color="#fff" />
      </Pressable>

      <Modal visible={formOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalHdr}>New event</Text>
            <Text style={styles.lbl}>Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {CALENDAR_EVENT_TYPES.map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => setEvtType(t)}
                    style={[styles.chip, evtType === t && styles.chipOn]}>
                    <Text style={[styles.chipTx, evtType === t && styles.chipTxOn]}>{t}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            <Text style={styles.lbl}>Location</Text>
            <TextInput
              value={locLabel}
              onChangeText={setLocLabel}
              placeholder="Label or GPS"
              placeholderTextColor={TacticalPalette.boneMuted}
              style={styles.input}
            />
            <Pressable onPress={() => void useGps()} style={styles.gpsBtn}>
              <Text style={styles.gpsTx}>Use GPS</Text>
            </Pressable>
            <Text style={styles.lbl}>Start</Text>
            <TextInput value={startIso} onChangeText={setStartIso} style={styles.input} placeholder="ISO / local" />
            <Text style={styles.lbl}>End</Text>
            <TextInput value={endIso} onChangeText={setEndIso} style={styles.input} />
            <Text style={styles.lbl}>Description</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              style={[styles.input, { minHeight: 72 }]}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setFormOpen(false)} style={styles.btnGhost}>
                <Text style={styles.btnGhostTx}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => void saveEvent()} style={styles.btnPrimary}>
                <Text style={styles.btnPrimaryTx}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: TacticalPalette.matteBlack, paddingHorizontal: 20, gap: 14 },
  shellApp: { backgroundColor: TacticalPalette.matteBlack },
  hdr: { fontSize: 22, fontWeight: "800", color: TacticalPalette.bone },
  hdrSm: { fontSize: 17, fontWeight: "800", color: TacticalPalette.bone },
  sub: { fontSize: 13, color: TacticalPalette.boneMuted, lineHeight: 18 },
  err: { color: "#ff8a80", fontSize: 14 },
  pinInput: {
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 20,
    letterSpacing: 4,
    color: TacticalPalette.bone,
    backgroundColor: TacticalPalette.charcoal,
    textAlign: "center",
  },
  pad: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "center", marginTop: 8 },
  key: {
    borderRadius: 12,
    backgroundColor: TacticalPalette.charcoal,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    alignItems: "center",
    justifyContent: "center",
  },
  keyGhost: { opacity: 0 },
  keyTx: { fontSize: 22, fontWeight: "700", color: TacticalPalette.bone },
  unlockBtn: {
    marginTop: 12,
    backgroundColor: TacticalPalette.accent,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  unlockTx: { color: "#fff", fontWeight: "800", fontSize: 16 },
  topBar: { paddingHorizontal: 16, gap: 6, marginBottom: 8 },
  monthNav: { flexDirection: "row", justifyContent: "flex-end", gap: 20 },
  monthNavTx: { fontSize: 14, color: TacticalPalette.boneMuted },
  weekRow: { flexDirection: "row", justifyContent: "center" },
  weekCell: { textAlign: "center", color: TacticalPalette.boneMuted, fontSize: 11, marginBottom: 4 },
  dayCell: {
    borderRadius: 8,
    margin: 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  daySelected: { backgroundColor: "rgba(127,142,92,0.25)", borderColor: TacticalPalette.coyote },
  dayTx: { color: TacticalPalette.bone, fontWeight: "600" },
  dayHdr: { marginTop: 12, marginBottom: 6, marginLeft: 16, fontSize: 15, fontWeight: "700", color: TacticalPalette.bone },
  list: { flex: 1 },
  empty: { color: TacticalPalette.boneMuted, marginLeft: 16 },
  card: {
    backgroundColor: TacticalPalette.charcoal,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: TacticalPalette.bone },
  cardMeta: { fontSize: 12, color: TacticalPalette.boneMuted, marginTop: 4 },
  cardBody: { fontSize: 14, color: TacticalPalette.bone, marginTop: 8 },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: TacticalPalette.accent,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: TacticalPalette.charcoal,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
    gap: 8,
    maxHeight: "90%",
  },
  modalHdr: { fontSize: 18, fontWeight: "800", color: TacticalPalette.bone, marginBottom: 8 },
  lbl: { fontSize: 12, fontWeight: "700", color: TacticalPalette.boneMuted, marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    borderRadius: 10,
    padding: 12,
    color: TacticalPalette.bone,
    backgroundColor: TacticalPalette.matteBlack,
  },
  gpsBtn: { alignSelf: "flex-start", paddingVertical: 8 },
  gpsTx: { color: TacticalPalette.coyote, fontWeight: "700" },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: TacticalPalette.border,
    backgroundColor: TacticalPalette.matteBlack,
  },
  chipOn: { borderColor: TacticalPalette.coyote, backgroundColor: "rgba(127,142,92,0.15)" },
  chipTx: { color: TacticalPalette.bone, fontSize: 13 },
  chipTxOn: { fontWeight: "800" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 16 },
  btnGhost: { paddingVertical: 12, paddingHorizontal: 16 },
  btnGhostTx: { color: TacticalPalette.boneMuted },
  btnPrimary: { backgroundColor: TacticalPalette.accent, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10 },
  btnPrimaryTx: { color: "#fff", fontWeight: "800" },
});
