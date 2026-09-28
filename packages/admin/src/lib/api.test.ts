import { afterEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('api', () => {
  it('sends JSON and parses the response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api('/x', { body: { a: 1 } })).resolves.toEqual({ ok: 1 })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/x',
      expect.objectContaining({ method: 'POST', body: '{"a":1}' }),
    )
  })

  it('throws ApiError with the server code and message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'forbidden', message: 'Nope' } }), {
          status: 403,
        }),
      ),
    )
    await expect(api('/x')).rejects.toEqual(new ApiError(403, 'forbidden', 'Nope'))
  })

  it('maps network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')))
    await expect(api('/x')).rejects.toMatchObject({ code: 'network' })
  })
})
