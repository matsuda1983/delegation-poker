// src/lib/utils.ts

/**
 * UUIDを生成する（crypto.randomUUID()があれば使用、なければフォールバック）
 */
export function generateUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // フォールバック: 簡易的なUUID v4風の生成
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * ルームIDを生成（6文字のランダム文字列）
 */
export function generateRoomId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 参加者IDを取得または生成（localStorage: dp_participant_id）
 */
export function getOrCreateParticipantId(): string {
  if (typeof window === "undefined") {
    return generateUUID();
  }
  
  const stored = localStorage.getItem("dp_participant_id");
  if (stored) {
    return stored;
  }
  
  const participantId = generateUUID();
  localStorage.setItem("dp_participant_id", participantId);
  return participantId;
}

/**
 * ホストIDを取得（localStorage: dp_host_id_{roomId}）
 */
export function getHostId(roomId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return localStorage.getItem(`dp_host_id_${roomId}`);
}

/**
 * ホストIDを保存（localStorage: dp_host_id_{roomId}）
 */
export function setHostId(roomId: string, hostId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(`dp_host_id_${roomId}`, hostId);
}
