/** The product name and bundle identifier, read from `src/shared/app/app-name.ts`. */
export declare function appIdentity(): { name: string; id: string }

/** Rewrites the development bundle's `Info.plist`; a no-op away from macOS. */
export declare function nameDevelopmentBundle(): boolean
