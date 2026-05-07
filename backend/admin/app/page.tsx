import { redirect } from "next/navigation";

export default function Home() {
  // With basePath=/backend, redirect to "/login" (Next will prefix automatically)
  redirect("/login");
}
