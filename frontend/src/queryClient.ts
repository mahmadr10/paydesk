import { QueryClient } from "@tanstack/react-query";

// Split into its own file (rather than declared inline in main.tsx) so any
// module - a socket event handler, a mutation's onSuccess - can import the
// SAME client instance and call queryClient.invalidateQueries() to tell
// TanStack Query "this data is stale, refetch it," without a circular
// import back to main.tsx.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
    },
  },
});
