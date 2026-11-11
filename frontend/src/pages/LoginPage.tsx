import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { getApiErrorMessage } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { loginSchema, type LoginForm } from "../validation";

const DEMO_PASSWORD = "DemoPass123!";
const DEMO_ACCOUNTS = [
  { label: "Demo buyer", hint: "Shop with PayPal, ask for a refund, open a dispute", email: "buyer@paydesk.test" },
  { label: "Demo seller", hint: "AI co-pilot: review and approve disputes and refunds", email: "seller@paydesk.test" },
  { label: "Demo admin", hint: "Seller view plus audit log and team", email: "admin@paydesk.test" },
];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);

  // React Hook Form manages field state/touched/dirty and re-renders only
  // what changed; the zodResolver plugs our Zod schema in as the validation
  // engine, so field-level errors (e.g. "Enter a valid email") appear as you
  // type, without us wiring up onChange handlers by hand for every field.
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(data: LoginForm) {
    setError(null);
    try {
      await login(data.email, data.password);
      navigate("/");
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  }

  // One-click login with a demo account (created by the backend when it runs
  // with DEMO_MODE=true).
  async function demoLogin(email: string) {
    setError(null);
    setDemoBusy(email);
    try {
      await login(email, DEMO_PASSWORD);
      navigate("/");
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setDemoBusy(null);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="mb-6 text-xl font-semibold text-slate-800">Log in</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <div>
          <input
            type="email"
            placeholder="Email"
            {...register("email")}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
          {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
        </div>
        <div>
          <input
            type="password"
            placeholder="Password"
            {...register("password")}
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          />
          {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">
        No account?{" "}
        <Link to="/register" className="text-blue-600 hover:underline">
          Register
        </Link>
      </p>
      <div className="mt-5 border-t border-slate-100 pt-4">
        <p className="mb-2 text-center text-xs font-medium text-slate-500">Try it with a demo account (one click)</p>
        <div className="flex flex-col gap-2">
          {DEMO_ACCOUNTS.map((d) => (
            <button
              key={d.email}
              type="button"
              onClick={() => demoLogin(d.email)}
              disabled={demoBusy !== null || isSubmitting}
              className="rounded border border-slate-200 px-3 py-2 text-left hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"
            >
              <span className="block text-sm font-medium text-slate-800">
                {demoBusy === d.email ? "Logging in…" : d.label}
              </span>
              <span className="block text-xs text-slate-500">{d.hint}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-center text-[11px] text-slate-400">
          Demo password for all three: <code>{DEMO_PASSWORD}</code>
        </p>
      </div>
    </div>
  );
}
