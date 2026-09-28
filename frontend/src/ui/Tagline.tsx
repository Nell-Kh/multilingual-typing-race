/** "Type in English · עברית · العربية", each name in its own script and font (ADR-032). */
export function Tagline({ className = '' }: { className?: string }) {
  return (
    <p className={`m-0 text-muted ${className}`} data-testid="tagline">
      {/* bdi: each name is isolated, or the two right-to-left names and the dot
          between them form one RTL run and swap places. */}
      Type in <bdi lang="en">English</bdi> · <bdi lang="he">עברית</bdi> · <bdi lang="ar">العربية</bdi>
    </p>
  )
}
