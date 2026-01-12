# Delegation Poker

チームで意思決定の「権限レベル」を合意形成するための
リアルタイム投票アプリです。

Delegation Poker（Management 3.0）の考え方をベースに、
複数人での投票・集計・履歴管理を行えます。

## 技術構成

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- Firebase Firestore

## 起動方法

1. Node.js 20 以上を用意
2. Firebase プロジェクトを作成
3. `.env.local` を作成し、Firebase 設定を記載
4. 以下を実行

```bash
npm install
npm run dev
```

## .env.local（例）

NEXT_PUBLIC_FIREBASE_API_KEY=xxxxxxxxxxxxxxxx
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=xxxxxxxxxxxxxxxx
NEXT_PUBLIC_FIREBASE_PROJECT_ID=xxxxxxxxxxxxxxxx
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=xxxxxxxxxxxxxxxx
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=xxxxxxxxxxxxxxxx
NEXT_PUBLIC_FIREBASE_APP_ID=xxxxxxxxxxxxxxxx

## 補足

本プロジェクトは create-next-app を利用して作成しています。
詳細な Next.js の使い方については公式ドキュメントを参照してください。
