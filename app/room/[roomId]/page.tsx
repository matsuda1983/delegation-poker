// app/room/[roomId]/page.tsx
import { Suspense } from "react";
import RoomClient from "./RoomClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <RoomClient />
    </Suspense>
  );
}
