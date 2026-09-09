type GeniusSignInProps = {
  error?: string | null;
};

export default function GeniusSignIn({ error }: GeniusSignInProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-6 py-12 text-gray-900">
      <section aria-labelledby="sign-in-title" className="w-full max-w-sm">
        <p className="text-sm font-semibold text-red-800">GENIUS Learning Platform</p>
        <h1 id="sign-in-title" className="mt-3 break-words text-3xl font-semibold">
          EngageAgent
        </h1>
        <p className="mt-3 text-base text-gray-600">GENIUS account sign-in</p>
        {error && (
          <p role="alert" className="mt-6 border-l-2 border-red-700 pl-3 text-sm text-red-800">
            Your EngageAgent session could not be verified. Sign-in is required again.
          </p>
        )}
        {/* GENIUS embeds agents in a sandbox that blocks top-level navigation. */}
        <a
          href="https://learn.ai4genius.org/login"
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          title="GENIUS sign-in (opens in a new tab)"
          className="mt-8 flex min-h-12 w-full items-center justify-center rounded-md bg-red-800 px-5 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-red-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-800"
        >
          Continue in GENIUS
        </a>
      </section>
    </main>
  );
}
