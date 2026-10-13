import { describe, expect, it } from 'vitest'
import { diffFilesOf } from './diff-parse'

const patch = `diff --git a/src/format/currency.ts b/src/format/currency.ts
index 1a2b3c4..5d6e7f8 100644
--- a/src/format/currency.ts
+++ b/src/format/currency.ts
@@ -18,3 +18,4 @@ export function formatPrice(
 export function formatPrice(cents: number, locale: string) {
-  return \`$\${(cents / 100).toFixed(2)}\`
+  const currency = CURRENCY_BY_LOCALE[locale] ?? 'USD'
+  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100)
 }
`

describe('the file list of a unified diff', () => {
  it('reads a file and counts what the hunks added and removed', () => {
    expect(diffFilesOf(patch)).toEqual([
      {
        path: 'src/format/currency.ts',
        previousPath: null,
        status: 'modified',
        additions: 2,
        deletions: 1,
        binary: false,
      },
    ])
  })

  it('reads several files, and added, removed and renamed ones', () => {
    const files = diffFilesOf(`diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+one
+two
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-bye
diff --git a/old/name.ts b/new/name.ts
similarity index 96%
rename from old/name.ts
rename to new/name.ts
--- a/old/name.ts
+++ b/new/name.ts
@@ -1,1 +1,1 @@
-a
+b
`)

    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ['new.ts', 'added', 2, 0],
      ['gone.ts', 'removed', 0, 1],
      ['new/name.ts', 'renamed', 1, 1],
    ])
    expect(files[2]!.previousPath).toBe('old/name.ts')
  })

  it('marks a binary file, which has no counts to read', () => {
    expect(
      diffFilesOf(`diff --git a/logo.png b/logo.png
index 0000000..1111111 100644
Binary files a/logo.png and b/logo.png differ
`),
    ).toEqual([{ path: 'logo.png', previousPath: null, status: 'modified', additions: 0, deletions: 0, binary: true }])
  })

  it('keeps a path with spaces and does not count "\\ No newline at end of file"', () => {
    const [file] = diffFilesOf(`diff --git a/a file.txt b/a file.txt
--- a/a file.txt	
+++ b/a file.txt	
@@ -1 +1 @@
-one
\\ No newline at end of file
+two
`)

    expect(file).toMatchObject({ path: 'a file.txt', additions: 1, deletions: 1 })
  })

  /*
   * The regression the old parser's hunk bookkeeping used to catch: a patch of several files is one
   * stream, and the `---`/`+++` of the second file must not be counted as a removal and an addition
   * on the first one.
   */
  it('stops counting a file where its hunks end', () => {
    const files = diffFilesOf(`diff --git a/one.ts b/one.ts
--- a/one.ts
+++ b/one.ts
@@ -1,1 +1,1 @@
-a
+b
diff --git a/two.ts b/two.ts
--- a/two.ts
+++ b/two.ts
@@ -1,1 +1,1 @@
-c
+d
`)

    expect(files.map((f) => [f.path, f.additions, f.deletions])).toEqual([
      ['one.ts', 1, 1],
      ['two.ts', 1, 1],
    ])
  })

  it('reads nothing from an empty patch', () => {
    expect(diffFilesOf('')).toEqual([])
    expect(diffFilesOf('\n')).toEqual([])
  })
})
