// PostHog is initialized from the client provider after React has hydrated.
// Initializing it here allowed the SDK to inject DOM nodes before hydration,
// which caused a mismatch with the server-rendered JSON-LD script.
export {}
