import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "70vh" }}>
      <SignIn />
    </main>
  );
}
