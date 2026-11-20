export interface ProductImageSearchResult {
  id: string;
  url: string;
  thumbnailUrl: string;
  title: string;
  source: string;
}

export async function searchOnlineProductImages(
  query: string,
  signal?: AbortSignal
): Promise<{ results: ProductImageSearchResult[]; source: string }> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { results: [], source: '' };
  }

  const res = await fetch(
    `/api/products/search-images?q=${encodeURIComponent(trimmed)}`,
    { signal }
  );

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || 'Unable to fetch online product images.');
  }

  return {
    results: Array.isArray(data.results) ? data.results : [],
    source: String(data.source || 'Web Image Search'),
  };
}

export async function cacheSelectedProductImage(
  candidate: Pick<ProductImageSearchResult, 'url' | 'thumbnailUrl'>
): Promise<string> {
  try {
    const res = await fetch('/api/products/cache-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrl: candidate.url,
        fallbackUrl: candidate.thumbnailUrl,
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success && typeof data.dataUrl === 'string') {
      return data.dataUrl;
    }
  } catch {
    // Fall through to CDN thumbnail/url
  }

  return candidate.thumbnailUrl || candidate.url;
}
