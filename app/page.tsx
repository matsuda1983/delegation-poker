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
  console.log("[firebase] db", db);
  const handleCreateRoom = async () => {
    console.log("[createRoom] start");

    if (!userName.trim()) {
      console.log("[createRoom] username empty");
      setError("名前を入力してください");
      return;
    }

    setIsCreating(true);
    setError("");

    try {
      const newRoomId = generateRoomId();
      const hostId = getOrCreateParticipantId();
      console.log("[createRoom] ids", { newRoomId, hostId });

      // ルームを作成
      console.log("[createRoom] creating room doc...");
      await withTimeout(
        setDoc(doc(db, "rooms", newRoomId), {
          status: "voting",
          hostId: hostId,
          createdAt: serverTimestamp(),
        }),
        15000,
        "setDoc rooms"
      );

      console.log("[createRoom] room doc created");

      // ホストIDを保存
      console.log("[createRoom] saving hostId to localStorage...");
      setHostId(newRoomId, hostId);
      console.log("[createRoom] hostId saved");

      // 参加者として追加
      console.log("[createRoom] creating participant doc...");
      await setDoc(doc(db, "rooms", newRoomId, "participants", hostId), {
        name: userName,
        selectedCard: null,
        updatedAt: serverTimestamp(),
      });
      console.log("[createRoom] participant doc created");

      // 遷移
      console.log("[createRoom] routing...");
      router.push(`/room/${newRoomId}?name=${encodeURIComponent(userName)}`);
      console.log("[createRoom] routed");
    } catch (err) {
      console.error("[createRoom] error", err);
      setError("ルームの作成に失敗しました");
    } finally {
      console.log("[createRoom] finally");
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
    <main className="min-h-screen p-8 bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-md mx-auto mt-20">
        <h1 className="text-4xl font-bold text-center mb-2 text-gray-800">
          デリゲーションポーカー
        </h1>
        <p className="text-center text-gray-600 mb-8">
          意思決定の権限レベルを合意形成しましょう
        </p>

        <div className="bg-white rounded-lg shadow-lg p-6 space-y-6">
          {/* ユーザー名入力 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              あなたの名前
            </label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="名前を入力"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={20}
            />
          </div>

          {/* ルーム作成 */}
          <div className="border-t pt-6">
            <h2 className="text-lg font-semibold mb-4 text-gray-800">
              新しいルームを作成
            </h2>
            <button
              onClick={handleCreateRoom}
              disabled={isCreating || isJoining}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {isCreating ? "作成中..." : "ルームを作成"}
            </button>
          </div>

          {/* ルーム参加 */}
          <div className="border-t pt-6">
            <h2 className="text-lg font-semibold mb-4 text-gray-800">
              既存のルームに参加
            </h2>
            <div className="space-y-3">
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                placeholder="ルームID（例: ABC123）"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent uppercase"
                maxLength={6}
              />
              <button
                onClick={handleJoinRoom}
                disabled={isCreating || isJoining}
                className="w-full bg-indigo-600 text-white py-3 rounded-lg font-medium hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {isJoining ? "参加中..." : "ルームに参加"}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
