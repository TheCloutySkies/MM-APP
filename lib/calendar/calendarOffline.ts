import AsyncStorage from "@react-native-async-storage/async-storage";
import localforage from "localforage";
import { Platform } from "react-native";

import type { CalendarEventPlain } from "@/lib/calendar/calendarTypes";

const LF = localforage.createInstance({ name: "mm-app", storeName: "calendar" });

/** Server row id → decrypted cache entry (web: IndexedDB via localforage; native: AsyncStorage JSON). */
const evKey = (mode: "real" | "decoy", id: string) => `mm:cal:ev:${mode}:${id}`;
const listKey = (mode: "real" | "decoy") => `mm:cal:list:${mode}`;
const queueKey = "mm:cal:sync-queue";

export type CalendarSyncJob =
  | { kind: "insert"; mode: "real" | "decoy"; rowId: string; encryptedPayload: string }
  | { kind: "delete"; mode: "real" | "decoy"; rowId: string };

async function setKv(key: string, value: string): Promise<void> {
  if (Platform.OS === "web" && typeof indexedDB !== "undefined") {
    await LF.setItem(key, value);
    return;
  }
  await AsyncStorage.setItem(key, value);
}

async function getKv(key: string): Promise<string | null> {
  if (Platform.OS === "web" && typeof indexedDB !== "undefined") {
    const v = await LF.getItem<string>(key);
    return v ?? null;
  }
  return AsyncStorage.getItem(key);
}

async function removeKv(key: string): Promise<void> {
  if (Platform.OS === "web" && typeof indexedDB !== "undefined") {
    await LF.removeItem(key);
    return;
  }
  await AsyncStorage.removeItem(key);
}

export async function offlinePutEvent(mode: "real" | "decoy", id: string, plain: CalendarEventPlain): Promise<void> {
  await setKv(evKey(mode, id), JSON.stringify(plain));
  const raw = await getKv(listKey(mode));
  const ids: string[] = raw ? (JSON.parse(raw) as string[]) : [];
  if (!ids.includes(id)) {
    ids.push(id);
    await setKv(listKey(mode), JSON.stringify(ids));
  }
}

export async function offlineRemoveEvent(mode: "real" | "decoy", id: string): Promise<void> {
  await removeKv(evKey(mode, id));
  const raw = await getKv(listKey(mode));
  if (!raw) return;
  const ids = (JSON.parse(raw) as string[]).filter((x) => x !== id);
  await setKv(listKey(mode), JSON.stringify(ids));
}

export async function offlineListEventIds(mode: "real" | "decoy"): Promise<string[]> {
  const raw = await getKv(listKey(mode));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export async function offlineGetEvent(mode: "real" | "decoy", id: string): Promise<CalendarEventPlain | null> {
  const raw = await getKv(evKey(mode, id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CalendarEventPlain;
  } catch {
    return null;
  }
}

export async function offlineEnqueue(job: CalendarSyncJob): Promise<void> {
  const raw = await getKv(queueKey);
  const q: CalendarSyncJob[] = raw ? (JSON.parse(raw) as CalendarSyncJob[]) : [];
  q.push(job);
  await setKv(queueKey, JSON.stringify(q));
}

export async function offlineDequeueAll(): Promise<CalendarSyncJob[]> {
  const raw = await getKv(queueKey);
  await removeKv(queueKey);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CalendarSyncJob[];
  } catch {
    return [];
  }
}

export async function offlinePeekQueue(): Promise<CalendarSyncJob[]> {
  const raw = await getKv(queueKey);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CalendarSyncJob[];
  } catch {
    return [];
  }
}

export async function offlineReplaceQueue(jobs: CalendarSyncJob[]): Promise<void> {
  if (jobs.length === 0) {
    await removeKv(queueKey);
    return;
  }
  await setKv(queueKey, JSON.stringify(jobs));
}
