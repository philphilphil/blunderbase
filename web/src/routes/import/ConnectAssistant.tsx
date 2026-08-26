import { Bot, Check, Copy } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { MCP_SERVER_NAME } from '@/lib/mcp/status'

/**
 * The other front door. Importing games is what makes the database worth asking about, so
 * this is where the config for a remote MCP client belongs: the URL is this page's own
 * origin, which is the one thing a copied snippet from anywhere else always gets wrong.
 *
 * The server is keyed by the same `MCP_SERVER_NAME` the titlebar shows, so the name in the
 * config a client is handed is the name the chrome talks about.
 *
 * The secret is deliberately a placeholder. `/mcp` accepts the owner's password, so a
 * config with the real one in it is a password on the clipboard and then in a file.
 */
const SECRET = '<your bearer key, or your Blunderbase password>'

function clientConfig(origin: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: 'http',
          url: `${origin}/mcp`,
          headers: { Authorization: `Bearer ${SECRET}` },
        },
      },
    },
    null,
    2,
  )
}

export function ConnectAssistant() {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const config = useMemo(() => clientConfig(window.location.origin), [])

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
  }, [])

  async function copy() {
    if (timer.current !== null) clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(config)
      setState('copied')
    } catch {
      // No clipboard permission, or no clipboard at all (an insecure origin) — say so, so
      // the button is not a no-op. The block above is selectable either way.
      setState('failed')
    }
    timer.current = setTimeout(() => setState('idle'), 1_800)
  }

  return (
    <section className="flex flex-col rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-3">
        <Bot className="size-3.5 text-faint" aria-hidden />
        <h2 className="text-xs font-semibold text-ink">Connect your assistant</h2>
        <div className="flex-1" />
        <span className="font-mono text-[0.625rem] text-dim">streamable HTTP at /mcp</span>
      </div>

      <div className="flex flex-col gap-3 px-3.5 py-3.5">
        <p className="text-[0.71875rem] leading-[1.5] text-dim">
          Every game you import is a fact the coach can query. Drop this into your MCP
          client&rsquo;s config and it reads this database over the same URL your browser
          is on.
        </p>

        <pre className="overflow-x-auto rounded-lg border border-hairline bg-elevated px-3 py-2.5 font-mono text-[0.65625rem] leading-[1.6] text-soft">
          {config}
        </pre>

        <div className="flex items-center gap-3">
          <p className="flex-1 text-[0.6875rem] leading-[1.5] text-faint">
            The key is <span className="font-mono text-soft-2">BLUNDERBASE_MCP_BEARER_KEY</span>{' '}
            where the deployment sets one, and your own password where it does not.{' '}
            <span className="font-mono text-soft-2">make mcp-key</span> prints the local URL
            and header.
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={() => void copy()}>
            {state === 'copied' ? <Check aria-hidden /> : <Copy aria-hidden />}
            {state === 'copied'
              ? 'Copied'
              : state === 'failed'
                ? 'No clipboard'
                : 'Copy config'}
          </Button>
        </div>
      </div>
    </section>
  )
}
