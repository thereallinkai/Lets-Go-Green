import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "@/components/login-form";
import { authCallbackErrorForLogin } from "@/src/lib/auth-callback";
import { BRAND } from "@/src/lib/brand";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ authError?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthShell>
      <div className="auth-card">
        <h1>Welcome back.</h1>
        <p>Continue with today&apos;s meals and the patterns you&apos;re building.</p>
        <LoginForm initialError={authCallbackErrorForLogin(params.authError)} />
        <p className="auth-switch">
          New to {BRAND.name}? <Link href="/register">Create an account</Link>
        </p>
      </div>
    </AuthShell>
  );
}
