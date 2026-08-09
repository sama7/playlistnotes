import { SignOutButton } from "@clerk/nextjs";
import { requireUser } from "@/lib/auth";

/**
 * Proves the full identity chain end to end: a verified Clerk session resolves
 * to exactly one local `users` row, created lazily on first sight.
 *
 * `requireUser()` derives the acting user from the session alone. Nothing here
 * reads an identifier from the URL or the client — that is the invariant the
 * whole authorization model rests on.
 */
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <main>
      <h1>Signed in</h1>
      <p className="lede">
        The chain works: a verified session resolved to one local user row.
      </p>

      <table>
        <tbody>
          <tr>
            <th scope="row">Local user ID</th>
            <td>
              <code>{user.id}</code>
            </td>
          </tr>
          <tr>
            <th scope="row">Clerk subject</th>
            <td>
              <code>{user.authSubject}</code>
            </td>
          </tr>
          <tr>
            <th scope="row">Username</th>
            <td>{user.username ?? <span className="note">not set yet</span>}</td>
          </tr>
          <tr>
            <th scope="row">Created</th>
            <td>{user.createdAt.toISOString()}</td>
          </tr>
        </tbody>
      </table>

      <p className="note" style={{ marginTop: "1.5rem" }}>
        The Clerk subject is the external identity. The local UUID is ours, and it
        is what every note and collection is scoped by — so the account survives
        changing auth providers.
      </p>

      <p style={{ marginTop: "1.5rem" }}>
        <SignOutButton />
      </p>
    </main>
  );
}
