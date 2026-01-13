"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  generateRoomId,
  getOrCreateParticipantId,
  setHostId,
  withName,
} from "../src/lib/utils";
import { db } from "../src/lib/firebase";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  serverTimestamp,
  collection,
  onSnapshot,
  query,
  limit,
  orderBy,
  Timestamp,
} from "firebase/firestore";

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms)
    ),
  ]);

// 結果データ抽出クエリ
export const dynamic = "force-dynamic";

// デプロイ時のビルドでアクセスされエラーになるため削除
// const q = query(collection(db, "vote_results"), orderBy("votedAt", "desc"));

// const snap = await getDocs(q);

// snap.docs.map((d) => ({
//   id: d.id,
//   roomId: d.data().roomId,
//   topic: d.data().topic,
//   first: d.data().first,
//   second: d.data().second,
//   third: d.data().third,
//   votedAt: d.data().votedAt,
// }));

export default function Home() {
  const router = useRouter();
  const [roomId, setRoomId] = useState("");
  const [userName, setUserName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState("");
  const [topic, setTopic] = useState("");

  type RoomOption = { id: string; topic: string; status?: string };
  const [roomOptions, setRoomOptions] = useState<RoomOption[]>([]);

  const searchParams = useSearchParams();

  // 投票結果取得用
  const [isResultsOpen, setIsResultsOpen] = useState(false);
  const [results, setResults] = useState<
    {
      id: string;
      roomId: string;
      topic: string;
      first: number | null;
      second: number | null;
      third: number | null;
      votedAt: any; // Timestamp
    }[]
  >([]);

  // 投票結果取得用
  const openResultsModal = async () => {
    try {
      const q = query(
        collection(db, "vote_results"),
        orderBy("votedAt", "desc"),
        limit(50) // 必要に応じて
      );
      const snap = await getDocs(q);

      const list = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          roomId: data.roomId,
          topic: data.topic,
          first: data.first ?? null,
          second: data.second ?? null,
          third: data.third ?? null,
          votedAt: data.votedAt,
        };
      });

      setResults(list);
      setIsResultsOpen(true);
    } catch (e) {
      console.error(e);
      alert("結果の取得に失敗しました");
    }
  };

  const formatDate = (ts: Timestamp | null | undefined) => {
    if (!ts) return "";
    const d = ts.toDate();
    return d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const RankIcon = ({ rank }: { rank: 1 | 2 | 3 }) => {
    if (rank === 1) return <span className="text-yellow-400 text-xl">👑</span>;
    if (rank === 2) return <span className="text-gray-400 text-lg">🥈</span>;
    if (rank === 3) return <span className="text-amber-700 text-lg">🥉</span>;
    return null;
  };

  useEffect(() => {
    const nameFromQuery = searchParams.get("name");
    if (nameFromQuery) {
      setUserName(nameFromQuery);
    }
  }, [searchParams]);

  useEffect(() => {
    const q = query(collection(db, "rooms"), limit(100));

    const unsub = onSnapshot(q, (snap) => {
      const list: {
        id: string;
        topic: string;
        status?: string;
        createdAt?: any;
      }[] = [];

      snap.forEach((d) => {
        const data = d.data() as any;

        // ended は除外
        if (data.status === "ended") return;

        list.push({
          id: d.id,
          topic: data.topic ?? "（未設定）",
          status: data.status,
          createdAt: data.createdAt,
        });
      });

      // 最新順（createdAt 降順）
      list.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() ?? 0;
        const bTime = b.createdAt?.toMillis?.() ?? 0;
        return bTime - aTime;
      });

      setRoomOptions(list);
    });

    return () => unsub();
  }, []);

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
      // router.push(`/room/${newRoomId}?name=${encodeURIComponent(userName)}`);
      router.push(withName(`/room/${newRoomId}`, userName));
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
      router.push(withName(`/room/${roomId.toUpperCase()}`, userName));
      // router.push(withName(`/room/${newRoomId}`, userName));
    } catch (err) {
      console.error("Error joining room:", err);
      setError("ルームへの参加に失敗しました");
      setIsJoining(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 pt-16">
      <div className="w-[95%] md:w-[70%] max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-2 text-gray-800">
          Delegation Poker
        </h1>
        <p className="text-center text-gray-600 mb-10">
          意思決定の権限レベルを合意形成しよう
        </p>
        <button
          type="button"
          onClick={openResultsModal}
          className="
    mt-2 mb-6 mx-auto block
    h-[52px] px-6
    rounded-xl
    border border-gray-400
    bg-white
    text-lg text-gray-700 font-medium
    shadow-sm
    transition-all duration-200
    hover:-translate-y-[1px] hover:shadow-md hover:bg-gray-50
    active:translate-y-0
  "
        >
          過去の投票結果を見る
        </button>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
            {error}
          </div>
        )}

        <div className="bg-white border border-gray-300 rounded-xl p-6 shadow-md">
          {/* 3カード構成 */}
          <div className="space-y-8">
            {/* ① 氏名カード */}
            {/* ① 氏名カード */}
            <div className="bg-white border border-gray-300 rounded-xl p-6 shadow-md">
              {" "}
              <h2 className="text-center text-base font-medium tracking-wide text-gray-800 mb-4">
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
                  className="w-full h-14 px-4 border border-gray-400 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  maxLength={20}
                />
              </div>
            </div>

            {/* ② 下段：作成/参加カード（2枚） */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              {/* ②-1 作成カード */}
              <div className="bg-white border border-gray-300 rounded-xl p-6 shadow-md">
                <h2 className="text-center text-base font-medium tracking-wide text-gray-800 mb-6">
                  新しいルームを作成
                </h2>

                <label className="block text-sm font-medium text-gray-700 mb-2">
                  デリゲーションテーマ
                </label>
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="〇〇の権限委譲について"
                  className="w-full h-14 px-4 border border-gray-400 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />

                <button
                  onClick={handleCreateRoom}
                  disabled={isCreating || isJoining}
                  className="
    cursor-pointer
    mt-10 w-full h-[52px]
    rounded-xl
    bg-gradient-to-r from-blue-500 to-indigo-500
    text-white text-lg font-semibold
    shadow-md
    transition-all duration-200
    hover:-translate-y-[1px] hover:shadow-lg
    active:translate-y-0 active:shadow-md
    disabled:opacity-60 disabled:cursor-not-allowed
  "
                >
                  {isCreating ? "作成中..." : "ルームを作成"}
                </button>
              </div>

              {/* ②-2 参加カード */}
              <div className="bg-white border border-gray-300 rounded-xl p-6 shadow-md">
                <h2 className="text-center text-base font-medium tracking-wide text-gray-800 mb-6">
                  既存のルームに参加
                </h2>

                <label className="block text-sm font-medium text-gray-700 mb-2">
                  ルームID
                </label>
                <div className="relative">
                  <select
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    className={`
                      w-full h-14
                      px-4 pr-10
                      border border-gray-400 rounded-lg
                      focus:ring-2 focus:ring-blue-500 focus:border-transparent
                      bg-white appearance-none
                      ${roomId === "" ? "text-gray-400" : "text-gray-800"}
                    `}
                  >
                    {/* 先頭を空の選択肢 */}
                    <option value="">（選択してください）</option>

                    {roomOptions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id} - {r.topic}
                      </option>
                    ))}
                  </select>

                  {/* ★ 自前の矢印（端すぎ問題を解消） */}
                  <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400">
                    <svg
                      className="h-5 w-5"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.24 4.5a.75.75 0 0 1-1.08 0l-4.24-4.5a.75.75 0 0 1 .02-1.06Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                </div>

                <button
                  onClick={handleJoinRoom}
                  disabled={isCreating || isJoining}
                  className="
    cursor-pointer
    mt-10 w-full h-[52px]
    rounded-xl
    bg-gradient-to-r from-slate-600 to-slate-700
    text-white text-lg font-semibold
    shadow-md
    transition-all duration-200
    hover:-translate-y-[1px] hover:shadow-lg
    active:translate-y-0 active:shadow-md
    disabled:opacity-60 disabled:cursor-not-allowed
  "
                >
                  {isJoining ? "参加中..." : "ルームに参加"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {isResultsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setIsResultsOpen(false)}
        >
          <div
            className="bg-white border border-gray-200 rounded-xl p-6 w-full max-w-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h2 className="text-base font-medium tracking-wide text-gray-800">
                投票結果
              </h2>
              <button
                className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
                onClick={() => setIsResultsOpen(false)}
              >
                閉じる
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
              {results.length === 0 ? (
                <p className="text-gray-500">結果がまだありません。</p>
              ) : (
                <div className="space-y-3">
                  {results.map((r) => (
                    <div key={r.id}>
                      <div className="rounded-lg border bg-white p-4">
                        {/* 上段：テーマ（左）＋順位（右） */}
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            {/* テーマ（赤枠） */}
                            <div className="mt-2 text-base font-semibold text-gray-900 break-words">
                              {r.topic?.trim() ? r.topic : "（テーマ未設定）"}
                            </div>
                          </div>

                          {/* 順位（右寄せ） */}
                          <div className="flex shrink-0 items-center gap-2">
                            {r.first != null && (
                              <div className="flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1">
                                <span className="text-yellow-400 text-xl">
                                  👑
                                </span>
                                <span className="font-semibold text-red-700">
                                  {r.first}
                                </span>
                              </div>
                            )}
                            {r.second != null && (
                              <div className="flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1">
                                <span className="text-gray-400 text-lg">
                                  🥈
                                </span>
                                <span className="font-semibold text-red-700">
                                  {r.second}
                                </span>
                              </div>
                            )}
                            {r.third != null && (
                              <div className="flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1">
                                <span className="text-amber-700 text-lg">
                                  🥉
                                </span>
                                <span className="font-semibold text-red-700">
                                  {r.third}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* 下段：ルームID（青枠）＋日付（右） */}
                        <div className="mt-2 flex items-center justify-between">
                          {/* ルームID（青枠） */}
                          <div className="text-xs text-gray-500">
                            {r.roomId}
                          </div>

                          {/* 日付（右、同じ高さ） */}
                          <div className="text-xs text-gray-500">
                            {formatDate(r.votedAt)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
