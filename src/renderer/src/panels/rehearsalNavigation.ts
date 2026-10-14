export type RehearsalNavigationGuard = (action: string) => Promise<boolean>

let guard: RehearsalNavigationGuard | null = null

/** Register the mounted rehearsal editor as the owner of navigation decisions. */
export function registerRehearsalNavigationGuard(next: RehearsalNavigationGuard): () => void {
  guard = next
  return () => {
    if (guard === next) guard = null
  }
}

/** Ask the mounted rehearsal editor before leaving its repository/workspace. */
export async function requestRehearsalNavigation(action: string): Promise<boolean> {
  return guard ? guard(action) : true
}
