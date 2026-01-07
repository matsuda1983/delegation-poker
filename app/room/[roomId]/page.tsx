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

import { Copy, Check } from "lucide-react";

interface Participant {
  participantId: string;
  name: string;
  selectedCard: number | null;
  online: boolean;
  lastSeenAt: Timestamp | null;
}

interface RoomData {
  status: "voting" | "revealed" | "ended";
  hostId: string;
  topic?: string;
  createdAt: unknown;
}

const CARD_VALUES = [1, 2, 3, 4, 5, 6, 7];

const DELEGATION_LEVELS = [
  { level: 1, title: "指示", description: "上司が決めて指示する" },
  { level: 2, title: "説得", description: "上司が決めて説明・説得する" },
  { level: 3, title: "相談", description: "意見を聞いた上で上司が決める" },
  { level: 4, title: "合意", description: "話し合って一緒に決める" },
  { level: 5, title: "助言", description: "部下が決め、必要なら助言する" },
  { level: 6, title: "委任", description: "部下が自由に決めて実行する" },
  { level: 7, title: "報告", description: "部下が決め、事後報告のみ" },
];

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
  const [hideOffline] = useState(false); // オフライン参加者も表示するか

  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const participantRefRef = useRef(
    doc(db, "rooms", roomId, "participants", participantId)
  );

  const isHost = roomData ? getHostId(roomId) === roomData.hostId : false;
  const isVoting = roomData?.status === "voting";
  const isRevealed = roomData?.status === "revealed";
  const [copied, setCopied] = useState(false);

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

  useEffect(() => {
    if (roomData?.status === "ended") {
      alert(
        `このテーマはホストにより終了されました。\nルーム指定画面に戻ります。\n\nルームID：${roomId}`
      );
      router.push("/");
    }
  }, [roomData?.status, router]);

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

  const CARD_VALUES = [1, 2, 3, 4, 5, 6, 7];
  // 投票結果を集計する関数
  const tallyVotes = (participants: { selectedCard: number | null }[]) => {
    const counts: Record<number, number> = Object.fromEntries(
      CARD_VALUES.map((v) => [v, 0])
    ) as Record<number, number>;

    for (const p of participants) {
      if (p.selectedCard != null)
        counts[p.selectedCard] = (counts[p.selectedCard] ?? 0) + 1;
    }
    return counts;
  };

  const counts = tallyVotes(participants);

  // 投票数を順位付きでソート
  const ranked = [...CARD_VALUES]
    .map((v) => ({ value: v, count: counts[v] ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const Crown = ({ rank }: { rank: number }) => {
    if (rank === 1) return <span className="text-yellow-400 text-3xl">👑</span>;
    if (rank === 2) return <span className="text-gray-400 text-2xl">🥈</span>;
    if (rank === 3) return <span className="text-amber-700 text-2xl">🥉</span>;
    return null;
  };

  // 同票対策：順位Map（value -> rank）
  const rankMap = new Map<number, number>();
  ranked.forEach((item, index) => {
    if (!rankMap.has(item.value)) {
      rankMap.set(item.value, index + 1);
    }
  });

  // オンライン参加者のみフィルタリング（hideOffline が true の場合）
  const visibleParticipants = hideOffline
    ? participants.filter((p) => p.online) // チェックON → オンラインだけ
    : participants;

  const notVotedCount = visibleParticipants.filter(
    (p) => p.selectedCard === null
  ).length;

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

  // ルーム終了用関数
  const handleEndRoom = async () => {
    if (!roomId || !isHost) return;

    const ok = window.confirm(
      `このテーマを終了しますか？\n他の参加者も退室となります。\n\nルームID：${roomId}`
    );
    if (!ok) return;

    try {
      await updateDoc(doc(db, "rooms", roomId), {
        status: "ended",
        endedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Error ending room:", err);
      alert("ルーム終了に失敗しました");
    }
  };

  return (
    <main className="min-h-screen p-8 bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-4xl mx-auto mb-4 flex items-center justify-between">
        {/* 左：ルームID + コピー */}
        <div className="flex items-center gap-2 text-gray-600">
          <span>ルームID：</span>
          <span className="text-2xl font-mono text-gray-800">{roomId}</span>

          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(roomId);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="cursor-pointer rounded-md p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700 transition"
            title="コピー"
          >
            {copied ? (
              <Check size={18} className="text-green-600" />
            ) : (
              <Copy size={18} />
            )}
          </button>
        </div>

        <button
          onClick={() => router.push("/")}
          className="cursor-pointer inline-flex items-center px-4 py-2 text-sm font-medium hover:bg-gray-50"
          style={{ fontSize: "18px", color: "#77787B" }}
        >
          ＜　ルーム指定に戻る
        </button>
      </div>

      <div className="max-w-4xl mx-auto">
        {/* ヘッダー */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex justify-center">
            <h1 className="text-3xl font-bold text-gray-800 text-center">
              {roomData?.topic ?? "（未設定）"}
            </h1>
          </div>
        </div>
        {/* カード選択エリア */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-800 text-center">
            権限レベルを選択してください
          </h2>

          {/* 1〜7の定義 */}
          {(() => {
            const LEVELS = [
              { level: 1, title: "指示", description: "上司が決めて指示する" },
              {
                level: 2,
                title: "説得",
                description: "上司が決めて説明・説得する",
              },
              {
                level: 3,
                title: "相談",
                description: "意見を聞いた上で上司が決める",
              },
              {
                level: 4,
                title: "合意",
                description: "話し合って一緒に決める",
              },
              {
                level: 5,
                title: "助言",
                description: "部下が決め、必要なら助言する",
              },
              {
                level: 6,
                title: "委任",
                description: "部下が自由に決めて実行する",
              },
              {
                level: 7,
                title: "報告",
                description: "部下が決め、事後報告のみ",
              },
            ];

            return (
              <>
                {/* レベル説明一覧 */}
                <div className="mt-6 mb-8 rounded-lg bg-gray-50 px-4 py-3 text-sm">
                  <ul className="space-y-1">
                    {LEVELS.map((l) => {
                      const active = selectedCard === l.level;

                      return (
                        <li
                          key={l.level}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleCardSelect(l.level)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ")
                              handleCardSelect(l.level);
                          }}
                          className={`
        flex gap-2 items-start rounded-md px-2 py-1 transition-colors
        cursor-pointer select-none
        ${active ? "bg-pink-100" : "hover:bg-gray-100"}
      `}
                        >
                          <span
                            className={`
          font-semibold whitespace-nowrap
          ${active ? "text-pink-600" : "text-red-500"}
        `}
                          >
                            {l.level}
                          </span>

                          <span
                            className={`
          font-semibold whitespace-nowrap
          ${active ? "text-pink-600" : "text-red-500"}
        `}
                          >
                            {l.title}
                          </span>

                          <span className="text-gray-600">
                            　：　{l.description}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* カード */}
                <div className="grid grid-cols-7 gap-3 mb-6">
                  {CARD_VALUES.map((value) => {
                    const meta = LEVELS.find((x) => x.level === value);
                    const active = selectedCard === value;

                    return (
                      <button
                        key={value}
                        onClick={() => handleCardSelect(value)}
                        disabled={isSubmitting}
                        className={`
                  group relative aspect-square rounded-lg font-bold transition-all
                  ${
                    active
                      ? "bg-pink-600/30 text-white scale-110 shadow-lg"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
                      >
                        {/* 数字 */}
                        <div className="text-lg leading-none">{value}</div>

                        {/* タイトル */}
                        <div
                          className="mt-3 font-medium leading-none text-red-500"
                          style={{ fontSize: "16px" }}
                        >
                          {meta?.title ?? ""}
                        </div>

                        {/* ツールチップ */}
                        <div
                          className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 hidden group-hover:block w-40 whitespace-normal break-words text-center rounded-md bg-gray-900 px-3 py-2 text-xs text-white leading-relaxed shadow-lg"
                          style={{ fontSize: "14px" }}
                        >
                          {meta?.description ?? ""}
                          <div className="absolute left-1/2 bottom-full -translate-x-1/2 h-0 w-0 border-x-4 border-x-transparent border-b-4 border-b-gray-900" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
        <p className="text-gray-600 mt-1 text-right mr-3">
          参加者 ： {visibleParticipants.length} 人
        </p>
        <p className="text-sm text-gray-600 mt-1 text-right">
          （未投票 ： {notVotedCount} 人）
        </p>
        {/* 参加者一覧 */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-gray-800 text-center">
              参加者
            </h2>
            {/* <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={hideOffline}
                onChange={(e) => setHideOffline(e.target.checked)}
                className="rounded"
              />
              <span>オフラインを非表示</span>
            </label> */}
          </div>
          <div className="space-y-2">
            {visibleParticipants.length === 0 ? (
              <p className="text-gray-400 text-center py-4">
                オンラインの参加者はいません
              </p>
            ) : (
              visibleParticipants.map((participant, index) => {
                const isMe = participant.participantId === participantId;
                const hasVoted = participant.selectedCard !== null;
                const zebraBg = index % 2 === 0 ? "bg-gray-200" : "bg-white";
                const offlineStyle = participant.online ? "" : "opacity-80";
                return (
                  <div
                    key={participant.participantId}
                    className={`flex items-center justify-between p-3 rounded-lg ${zebraBg} ${offlineStyle}`}
                  >
                    <span className="font-medium text-gray-800 flex items-center gap-2">
                      {participant.online ? (
                        <span className="text-green-600" title="オンライン">
                          ●
                        </span>
                      ) : (
                        <span className="text-gray-600" title="オフライン">
                          ○
                        </span>
                      )}
                      {participant.name}
                      {isMe && !isHost && (
                        <span className="ml-2 text-xs text-blue-600">
                          (あなた)
                        </span>
                      )}
                      {isMe && isHost && (
                        <span className="ml-2 text-xs text-blue-600">
                          (あなた・ホスト)
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
        {/* 投票結果集計エリア */}
        {isRevealed && (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6 mt-6">
            <h2 className="text-xl font-semibold mb-4 text-gray-800 text-center">
              投票結果
            </h2>

            <div className="grid grid-cols-7 gap-3">
              {CARD_VALUES.map((v) => {
                const rank = rankMap.get(v);
                const voteCount = counts[v] ?? 0;
                const showCrown = voteCount > 0 && rank && rank <= 3;

                return (
                  <div
                    key={v}
                    className={`rounded-lg p-3 text-center relative ${
                      rank === 1 && voteCount > 0
                        ? "bg-yellow-50"
                        : "bg-gray-50"
                    }`}
                  >
                    {/* 王冠（左上） */}
                    {showCrown && (
                      <div className="absolute top-1 left-1">
                        <Crown rank={rank!} />
                      </div>
                    )}

                    <div className="text-lg font-bold">{v}</div>

                    <div
                      className="text-sm text-red-500"
                      style={{ fontSize: "14px" }}
                    >
                      {voteCount}票
                    </div>

                    {showCrown && (
                      <div className="mt-1 text-xs text-gray-500">{rank}位</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* ホスト専用アクションボタン */}
        {isHost && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex gap-3">
              {isVoting && (
                <button
                  onClick={handleReveal}
                  className="cursor-pointer flex-1 bg-green-600 text-white py-3 rounded-lg font-medium hover:bg-green-700 transition-colors"
                >
                  投票を締め切る
                </button>
              )}
              {isRevealed && (
                <button
                  onClick={handleNextRound}
                  className="flex-1 bg-gray-600 text-white py-3 rounded-lg font-medium hover:bg-gray-700 transition-colors"
                >
                  同じテーマで再投票
                </button>
              )}
            </div>
            {isRevealed && (
              <div className="max-w-4xl mx-auto mt-4 flex justify-end">
                <button
                  onClick={handleEndRoom}
                  className="cursor-pointer inline-flex items-center px-4 text-sm font-medium hover:bg-gray-50"
                  style={{ fontSize: "16px", color: "#77787B" }}
                >
                  ＜　このテーマを終了する
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
