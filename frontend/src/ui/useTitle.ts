import { useEffect } from 'react'

export const PRODUCT = 'Keyrace'

/** "Practice · Keyrace" in the tab; just the product name on the home page. */
export function useTitle(page?: string) {
  useEffect(() => {
    document.title = page ? `${page} · ${PRODUCT}` : PRODUCT
  }, [page])
}
