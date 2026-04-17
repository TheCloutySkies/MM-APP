import type { IMessage } from "react-native-gifted-chat";

import type { ChatChannelTab, DmPeer, LiveChatEnvelope } from "@/hooks/useLiveSocket";

export type MmGiftedMessage = IMessage & {
  /** Original server envelope for custom views (file, location) and captions. */
  mmEnvelope: LiveChatEnvelope;
};

function msgIdNum(id: string): number {
  const n = Number(id);
  return Number.isFinite(n) ? n : 0;
}

function peerHasRead(peerLastRead: string | undefined, messageId: string): boolean {
  if (!peerLastRead) return false;
  return msgIdNum(peerLastRead) >= msgIdNum(messageId);
}

function envelopeToGifted(
  e: LiveChatEnvelope,
  profileId: string,
  selfName: string,
  channelTab: ChatChannelTab,
  peerReadId: string | undefined,
  deliveryByMessageId: Record<string, "sent" | "delivered">,
): MmGiftedMessage {
  const mine = e.sender_user_id === profileId;
  const user = {
    _id: e.sender_user_id,
    name: mine ? selfName : e.sender_display_name || e.sender_user_id.slice(0, 8) || "Member",
  };

  let text = e.text ?? "";
  let image: string | undefined;
  let location: { latitude: number; longitude: number } | undefined;

  if (e.kind === "image" && e.attachment?.public_url) {
    image = e.attachment.public_url;
    if (!text || text === (e.attachment.filename ?? "")) text = "";
  } else if (e.kind === "file") {
    text =
      e.text && e.attachment?.filename && e.text !== e.attachment.filename
        ? e.text
        : "";
  } else if (e.kind === "location" && e.location) {
    location = { latitude: e.location.lat, longitude: e.location.lng };
  }

  let pending: boolean | undefined;
  let sent: boolean | undefined;
  let received: boolean | undefined;
  if (mine) {
    if (e.message_id.startsWith("local-")) pending = true;
    else {
      sent = true;
      const readByPeer = channelTab === "private" && peerHasRead(peerReadId, e.message_id);
      const delivered = deliveryByMessageId[e.message_id] === "delivered";
      received = readByPeer || delivered;
    }
  }

  return {
    _id: e.message_id,
    text,
    createdAt: new Date(e.created_at_ms),
    user,
    image,
    location,
    pending,
    sent,
    received,
    mmEnvelope: e,
  };
}

/**
 * `useLiveSocket` stores messages oldest-first (history + append).
 * GiftedChat (inverted) expects newest-first.
 */
export function liveMessagesToGiftedMessages(
  messagesOldestFirst: LiveChatEnvelope[],
  profileId: string,
  selfName: string,
  channelTab: ChatChannelTab,
  dmPeer: DmPeer | null,
  readReceipts: Record<string, string>,
  deliveryByMessageId: Record<string, "sent" | "delivered">,
): MmGiftedMessage[] {
  const peerReadId = dmPeer ? readReceipts[dmPeer.id] : undefined;
  const out: MmGiftedMessage[] = [];
  for (let i = messagesOldestFirst.length - 1; i >= 0; i--) {
    out.push(
      envelopeToGifted(
        messagesOldestFirst[i]!,
        profileId,
        selfName,
        channelTab,
        peerReadId,
        deliveryByMessageId,
      ),
    );
  }
  return out;
}
