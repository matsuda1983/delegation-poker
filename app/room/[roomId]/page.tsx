"use client";

import { useEffect, useState } from "react";
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
} from "firebase/firestore";
import { getOrCreateParticipantId, getHostId } from "../../../src/lib/utils";

interface Participant {
  participantId: string;
  name: string;
  selectedCard: number | null;
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

  const isHost = roomData ? getHostId(roomId) === roomData.hostId : false;
  const isVoting = roomData?.status === "voting";
  const isRevealed = roomData?.status === "revealed";

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
      const participantsList: Participant[] = [];
      snapshot.forEach((participantDoc) => {
        const data = participantDoc.data();
        participantsList.push({
          participantId: participantDoc.id,
          name: data.name,
          selectedCard: data.selectedCard,
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

  // 参加者の追加（まだ存在しない場合）
  useEffect(() => {
    if (!roomId || !participantId || !userName) return;

    const participantRef = doc(
      db,
      "rooms",
      roomId,
      "participants",
      participantId
    );

    // 参加者が存在するか確認
    const checkAndAdd = async () => {
      const snap = await getDoc(participantRef);
      if (!snap.exists()) {
        await setDoc(participantRef, {
          name: userName,
          selectedCard: null,
          updatedAt: serverTimestamp(),
        });
      }
    };

    checkAndAdd().catch((err) => {
      console.error("Error adding participant:", err);
    });
  }, [roomId, participantId, userName]);

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
                参加者: {participants.length}人
                {isHost && <span className="ml-2 text-blue-600">(ホスト)</span>}
              </p>
            </div>
            <button
              onClick={() => router.push("/")}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
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
          <h2 className="text-xl font-semibold mb-4 text-gray-800">参加者</h2>
          <div className="space-y-2">
            {participants.map((participant) => {
              const isMe = participant.participantId === participantId;
              const hasVoted = participant.selectedCard !== null;

              return (
                <div
                  key={participant.participantId}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <span className="font-medium text-gray-800">
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
            })}
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
