/**
 * Which forge a repository lives on.
 *
 * Its own module so the URL helpers and the two providers can share it without
 * importing `host.ts`, which imports the providers back.
 */
export type HostKind = 'github' | 'gitlab' | 'unknown'
