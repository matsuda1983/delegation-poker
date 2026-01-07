"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  generateRoomId,
  getOrCreateParticipantId,
  setHostId,
} from "../src/lib/utils";
import { db } from "../src/lib/firebase";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms)
    ),
  ]);

export default function Home() {
  const router = useRouter();
  const [roomId, setRoomId] = useState("");
  const [userName, setUserName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState("");
  const [topic, setTopic] = useState("");

  const handleCreateRoom = async () => {
    if (!userName.trim()) {
      setError("名前を入力してください");
      return;
    }

    if (!topic.trim()) {
      setError("デリゲーションテーマを入力してください");
      return;
    }

    setIsCreating(true);
    setError("");

    try {
      const newRoomId = generateRoomId();
      const hostId = getOrCreateParticipantId();

      // ルームを作成
      await withTimeout(
        setDoc(doc(db, "rooms", newRoomId), {
          status: "voting",
          hostId: hostId,
          topic: topic.trim(),
          createdAt: serverTimestamp(),
        }),
        15000,
        "setDoc rooms"
      );

      // ホストIDを保存
      setHostId(newRoomId, hostId);

      // 参加者として追加
      await setDoc(doc(db, "rooms", newRoomId, "participants", hostId), {
        name: userName,
        selectedCard: null,
        online: true,
        lastSeenAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 遷移
      router.push(`/room/${newRoomId}?name=${encodeURIComponent(userName)}`);
    } catch (err) {
      console.error("[createRoom] error", err);
      setError("ルームの作成に失敗しました");
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!roomId.trim()) {
      setError("ルームIDを入力してください");
      return;
    }
    if (!userName.trim()) {
      setError("名前を入力してください");
      return;
    }

    setIsJoining(true);
    setError("");

    try {
      // ルームが存在するか確認
      const roomDoc = await getDoc(doc(db, "rooms", roomId.toUpperCase()));

      if (!roomDoc.exists()) {
        setError("ルームが見つかりませんでした");
        setIsJoining(false);
        return;
      }

      // ルームページに遷移
      router.push(
        `/room/${roomId.toUpperCase()}?name=${encodeURIComponent(userName)}`
      );
    } catch (err) {
      console.error("Error joining room:", err);
      setError("ルームへの参加に失敗しました");
      setIsJoining(false);
    }
  };

  return (
    <main className="min-h-screen p-8 bg-gradient-to-br from-white-50 to-indigo-100">
      <div className="w-[95%] md:w-[70%] max-w-6xl mx-auto mt-16">
        <h1 className="text-4xl font-bold text-center mb-2 text-gray-800">
          Delegation Poker
        </h1>
        <p className="text-center text-gray-600 mb-10">
          意思決定の権限レベルを合意形成しよう
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
            {error}
          </div>
        )}

        <div
          className="rounded-lg shadow-lg p-8"
          style={{ backgroundColor: "rgb(127 127 127)" }}
        >
          {/* 3カード構成 */}
          <div className="space-y-8">
            {/* ① 氏名カード */}
            <div className="bg-white rounded-lg shadow-lg p-8">
              {" "}
              <h2 className="text-center text-lg font-semibold text-gray-800 mb-4">
                基本情報
              </h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  あなたの名前
                </label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="名前を入力"
                  className="w-full h-14 px-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  maxLength={20}
                />
              </div>
            </div>

            {/* ② 下段：作成/参加カード（2枚） */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              {/* ②-1 作成カード */}
              <div className="bg-white rounded-lg shadow-lg p-8">
                <h2 className="text-center text-lg font-semibold text-gray-800 mb-6">
                  新しいルームを作成
                </h2>

                <label className="block text-sm font-medium text-gray-700 mb-2">
                  デリゲーションテーマ
                </label>
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="〇〇の権限委譲について"
                  className="w-full h-14 px-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />

                <button
                  onClick={handleCreateRoom}
                  disabled={isCreating || isJoining}
                  className="cursor-pointer mt-10 w-full h-14 bg-blue-600/70 text-white rounded-lg font-semibold text-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
                >
                  {isCreating ? "作成中..." : "ルームを作成"}
                </button>
              </div>

              {/* ②-2 参加カード */}
              <div className="bg-white rounded-lg shadow-lg p-8">
                <h2 className="text-center text-lg font-semibold text-gray-800 mb-6">
                  既存のルームに参加
                </h2>

                <label className="block text-sm font-medium text-gray-700 mb-2">
                  ルームID
                </label>
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  className="w-full h-14 px-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent uppercase"
                  maxLength={6}
                />

                <button
                  onClick={handleJoinRoom}
                  disabled={isCreating || isJoining}
                  className="cursor-pointer mt-10 w-full h-14 bg-pink-500/80 hover:bg-pink-500 text-white rounded-lg font-semibold text-lg hover:bg-indigo-700 disabled:bg-gray-400 transition-colors"
                >
                  {isJoining ? "参加中..." : "ルームに参加"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
