import { redirect } from "next/navigation";

export default function Home() {
  // proxy.ts has already bounced anyone without a session to /login.
  redirect("/kits");
}
