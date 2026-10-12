import { getCurrentMemberId } from "@/lib/members/auth";
import HomeSearch from "./HomeSearch";

export default async function Home() {
  const memberId = await getCurrentMemberId();
  return <HomeSearch isSignedIn={memberId !== null} />;
}
