"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { db } from "../../../src/lib/firebase";
import {
  doc,
  collection,
  onSnapshot,
  updateDoc,
  setDoc,
  serverTimestamp,
  getDoc,
  getDocs,
  writeBatch,
  Timestamp,
} from "firebase/firestore";
import {
  getOrCreateParticipantId,
  getHostId,
  PRESENCE_CONFIG,
} from "../../../src/lib/utils";

interface Participant {
  participantId: string;
  name: string;
  selectedCard: number | null;
  online: boolean;
  lastSeenAt: Timestamp | null;
}

interface RoomData {
  status: "voting" | "revealed";
  hostId: string;
  createdAt: unknown;
}

const CARD_VALUES = [1, 2, 3, 4, 5, 6, 7];

export default function RoomPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const roomId = params.roomId as string;
  const userName = searchParams.get("name") || "匿名";

  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantId] = useState(() => getOrCreateParticipantId());
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showOffline, setShowOffline] = useState(false); // オフライン参加者も表示するか

  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const participantRefRef = useRef(
    doc(db, "rooms", roomId, "participants", participantId)
  );

  const isHost = roomData ? getHostId(roomId) === roomData.hostId : false;
  const isVoting = roomData?.status === "voting";
  const isRevealed = roomData?.status === "revealed";

  // オンライン状態を更新する関数
  const updateOnlineStatus = useCallback(
    async (online: boolean) => {
      if (!roomId || !participantId) return;

      try {
        const participantRef = doc(
          db,
          "rooms",
          roomId,
          "participants",
          participantId
        );
        await updateDoc(participantRef, {
          online,
          lastSeenAt: serverTimestamp(),
        });
      } catch (err) {
        console.error("Error updating online status:", err);
      }
    },
    [roomId, participantId]
  );

  // ルームデータの購読
  useEffect(() => {
    if (!roomId) return;

    const roomRef = doc(db, "rooms", roomId);

    const unsubscribe = onSnapshot(roomRef, (snapshot) => {
      if (!snapshot.exists()) {
        alert("ルームが見つかりませんでした");
        router.push("/");
        return;
      }

      const data = snapshot.data() as RoomData;
      setRoomData(data);
    });

    return () => unsubscribe();
  }, [roomId, router]);

  // 参加者コレクションの購読
  useEffect(() => {
    if (!roomId) return;

    const participantsRef = collection(db, "rooms", roomId, "participants");

    const unsubscribe = onSnapshot(participantsRef, (snapshot) => {
      const now = Date.now();
      const participantsList: Participant[] = [];

      snapshot.forEach((participantDoc) => {
        const data = participantDoc.data();
        const lastSeenAt = data.lastSeenAt as Timestamp | null;
        const online = data.online === true;

        // オフライン判定: online が false または lastSeenAt が 30秒以上前
        let isOnline = online;
        if (lastSeenAt) {
          const lastSeenMs = lastSeenAt.toMillis();
          const timeSinceLastSeen = now - lastSeenMs;
          if (timeSinceLastSeen > PRESENCE_CONFIG.OFFLINE_THRESHOLD_MS) {
            isOnline = false;
          }
        } else if (!online) {
          isOnline = false;
        }

        participantsList.push({
          participantId: participantDoc.id,
          name: data.name,
          selectedCard: data.selectedCard,
          online: isOnline,
          lastSeenAt,
        });
      });

      setParticipants(participantsList);

      // 自分の投票状態を取得
      const myParticipant = participantsList.find(
        (p) => p.participantId === participantId
      );
      if (myParticipant) {
        setSelectedCard(myParticipant.selectedCard);
      }
    });

    return () => unsubscribe();
  }, [roomId, participantId]);

  // 参加者の追加（まだ存在しない場合）とオンライン状態の設定
  useEffect(() => {
    if (!roomId || !participantId || !userName) return;

    const participantRef = doc(
      db,
      "rooms",
      roomId,
      "participants",
      participantId
    );
    participantRefRef.current = participantRef;

    // 参加者が存在するか確認して追加/更新
    const checkAndAdd = async () => {
      const snap = await getDoc(participantRef);
      if (!snap.exists()) {
        await setDoc(participantRef, {
          name: userName,
          selectedCard: null,
          online: true,
          lastSeenAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        // 既存の参加者の場合、オンライン状態を更新
        await updateDoc(participantRef, {
          online: true,
          lastSeenAt: serverTimestamp(),
        });
      }
    };

    checkAndAdd().catch((err) => {
      console.error("Error adding participant:", err);
    });
  }, [roomId, participantId, userName]);

  // Heartbeat: 定期的にオンライン状態を更新
  useEffect(() => {
    console.log("[presence] start", roomId, participantId);
    if (!roomId || !participantId) return;

    const sendHeartbeat = async () => {
      await updateOnlineStatus(true);
    };

    // 初回の heartbeat を即座に送信
    sendHeartbeat();

    // 定期的に heartbeat を送信
    heartbeatIntervalRef.current = setInterval(
      sendHeartbeat,
      PRESENCE_CONFIG.HEARTBEAT_INTERVAL_MS
    );

    return () => {
      console.log("[presence] cleanup", roomId, participantId);
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      updateOnlineStatus(false).catch(() => {});
    };
  }, [roomId, participantId, updateOnlineStatus]);

  // ページを離れる際にオフライン状態に設定
  useEffect(() => {
    const handleBeforeUnload = () => {
      // beforeunload では非同期処理が確実に実行されないため、
      // navigator.sendBeacon や fetch を使う方が良いが、
      // Firestore の updateDoc は非同期なので、ここでは試みるだけ
      updateOnlineStatus(false).catch(() => {
        // エラーは無視（ページが閉じられるため）
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // ページが非表示になったらオフライン状態に設定
        updateOnlineStatus(false).catch((err) => {
          console.error("Error updating offline status:", err);
        });
      } else if (document.visibilityState === "visible") {
        // ページが表示されたらオンライン状態に設定
        updateOnlineStatus(true).catch((err) => {
          console.error("Error updating online status:", err);
        });
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      // コンポーネントがアンマウントされる際にオフライン状態に設定
      updateOnlineStatus(false).catch(() => {
        // エラーは無視
      });
    };
  }, [roomId, participantId, updateOnlineStatus]);

  const handleCardSelect = async (value: number) => {
    if (!roomId || isSubmitting) return;
    if (!isVoting) return;

    setIsSubmitting(true);
    try {
      const participantRef = doc(
        db,
        "rooms",
        roomId,
        "participants",
        participantId
      );

      const newCard = selectedCard === value ? null : value; // 同じカードをクリックしたら取り消し

      await updateDoc(participantRef, {
        selectedCard: newCard,
        updatedAt: serverTimestamp(),
      });

      setSelectedCard(newCard);
    } catch (err) {
      console.error("Error updating vote:", err);
      alert("投票の更新に失敗しました");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReveal = async () => {
    if (!roomId || !isHost) return;

    try {
      const roomRef = doc(db, "rooms", roomId);
      await updateDoc(roomRef, {
        status: "revealed",
      });
    } catch (err) {
      console.error("Error revealing results:", err);
      alert("結果の表示に失敗しました");
    }
  };

  const handleNextRound = async () => {
    if (!roomId || !isHost) return;

    if (!confirm("全員の投票をリセットして次のラウンドに進みますか？")) {
      return;
    }

    try {
      const roomRef = doc(db, "rooms", roomId);
      const participantsRef = collection(db, "rooms", roomId, "participants");

      // バッチ処理で全参加者のselectedCardをnullに更新
      const snapshot = await getDocs(participantsRef);
      const batch = writeBatch(db);

      batch.update(roomRef, {
        status: "voting",
      });

      snapshot.forEach((participantDoc) => {
        batch.update(participantDoc.ref, {
          selectedCard: null,
          updatedAt: serverTimestamp(),
        });
      });

      await batch.commit();
      setSelectedCard(null);
    } catch (err) {
      console.error("Error resetting votes:", err);
      alert("リセットに失敗しました");
    }
  };

  const handleGoHome = async () => {
    // ホームに戻る前にオフライン状態に設定
    await updateOnlineStatus(false);
    router.push("/");
  };

  // オンライン参加者のみフィルタリング（showOffline が false の場合）
  const visibleParticipants = showOffline
    ? participants
    : participants.filter((p) => p.online);

  if (!roomData) {
    return (
      <main className="min-h-screen p-8 bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">ルームを読み込み中...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8 bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-4xl mx-auto">
        {/* ヘッダー */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">
                ルーム: {roomId}
              </h1>
              <p className="text-gray-600 mt-1">
                参加者: {visibleParticipants.length}人
                {showOffline &&
                  participants.length > visibleParticipants.length && (
                    <span className="text-gray-400">
                      {" "}
                      (オフライン:{" "}
                      {participants.length - visibleParticipants.length}人)
                    </span>
                  )}
                {isHost && <span className="ml-2 text-blue-600">(ホスト)</span>}
              </p>
            </div>
            <button
              onClick={async () => {
                await updateOnlineStatus(false).catch(() => {});
                router.push("/");
              }}
            >
              ← ホームに戻る
            </button>
          </div>
        </div>

        {/* カード選択エリア */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">
            権限レベルを選択してください
          </h2>
          <div className="grid grid-cols-7 gap-3 mb-6">
            {CARD_VALUES.map((value) => (
              <button
                key={value}
                onClick={() => handleCardSelect(value)}
                disabled={isSubmitting}
                className={`
                  aspect-square rounded-lg font-bold text-lg transition-all
                  ${
                    selectedCard === value
                      ? "bg-blue-600 text-white scale-110 shadow-lg"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
              >
                {value}
              </button>
            ))}
          </div>
          {selectedCard && (
            <p className="text-sm text-gray-600 text-center">
              選択中: {selectedCard}
            </p>
          )}
        </div>

        {/* 参加者一覧 */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-800">参加者</h2>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showOffline}
                onChange={(e) => setShowOffline(e.target.checked)}
                className="rounded"
              />
              <span>オフラインも表示</span>
            </label>
          </div>
          <div className="space-y-2">
            {visibleParticipants.length === 0 ? (
              <p className="text-gray-400 text-center py-4">
                オンラインの参加者はいません
              </p>
            ) : (
              visibleParticipants.map((participant) => {
                const isMe = participant.participantId === participantId;
                const hasVoted = participant.selectedCard !== null;

                return (
                  <div
                    key={participant.participantId}
                    className={`flex items-center justify-between p-3 rounded-lg ${
                      participant.online
                        ? "bg-gray-50"
                        : "bg-gray-100 opacity-60"
                    }`}
                  >
                    <span className="font-medium text-gray-800 flex items-center gap-2">
                      {participant.online ? (
                        <span className="text-green-600" title="オンライン">
                          ●
                        </span>
                      ) : (
                        <span className="text-gray-400" title="オフライン">
                          ○
                        </span>
                      )}
                      {participant.name}
                      {isMe && (
                        <span className="ml-2 text-xs text-blue-600">
                          (あなた)
                        </span>
                      )}
                    </span>
                    <span className="text-gray-600">
                      {hasVoted ? (
                        isRevealed || isMe ? (
                          <span className="font-bold text-blue-600">
                            {participant.selectedCard}
                          </span>
                        ) : (
                          <span className="font-bold text-green-600">✓</span>
                        )
                      ) : (
                        <span className="text-gray-400">未投票</span>
                      )}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ホスト専用アクションボタン */}
        {isHost && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex gap-3">
              {isVoting && (
                <button
                  onClick={handleReveal}
                  className="flex-1 bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 transition-colors"
                >
                  結果を表示 (Reveal)
                </button>
              )}
              {isRevealed && (
                <button
                  onClick={handleNextRound}
                  className="flex-1 bg-gray-600 text-white py-3 rounded-lg font-medium hover:bg-gray-700 transition-colors"
                >
                  次のラウンド (Next Round)
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
