import { Trans, useLingui } from '@lingui/react/macro'
import { Bot } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { SetPageChrome } from '@/components/shell/PageChrome'
import { PageBody, PageHeader } from '@/components/shell/PageHeader'
import type { McpKeyCreated } from '@/lib/api/types'
import { MCP_SERVER_NAME } from '@/lib/mcp/status'

import { Snippet } from './CopyButton'
import { McpKeys } from './McpKeys'

/**
 * The other front door. A client that speaks MCP reads this database the way the app does,
 * so the config for one belongs on the owner's own shelf rather than buried under Import.
 *
 * The URL is this page's own origin, which is the one thing a snippet copied from anywhere
 * else always gets wrong. The server is keyed by the same `MCP_SERVER_NAME` the titlebar
 * shows, so the name in the config a client is handed is the name the chrome talks about.
 *
 * The secret in a snippet is a placeholder unless a key was minted a moment ago. `/mcp`
 * still accepts the owner's password, but a password in a config file is a password on
 * disk; a bearer key is what belongs there, and this page is where they are minted. The
 * token exists in the create response and in this component's state, and nowhere else —
 * "Done" on the reveal panel drops it and the snippets go back to the placeholder.
 */
const PLACEHOLDER = '<your bearer key>'

function clientConfig(origin: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: 'http',
          url: `${origin}/mcp`,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  )
}

function claudeCodeCommand(origin: string, token: string): string {
  return `claude mcp add --transport http ${MCP_SERVER_NAME} ${origin}/mcp --header "Authorization: Bearer ${token}"`
}

function codexCommands(origin: string, token: string): string {
  return [
    `export BLUNDERBASE_MCP_KEY="${token}"   # add to your shell profile too`,
    `codex mcp add ${MCP_SERVER_NAME} --url ${origin}/mcp --bearer-token-env-var BLUNDERBASE_MCP_KEY`,
  ].join('\n')
}

export function McpPage() {
  const { t } = useLingui()
  const [minted, setMinted] = useState<McpKeyCreated | null>(null)
  const token = minted?.token ?? PLACEHOLDER
  const origin = window.location.origin
  const config = useMemo(() => clientConfig(origin, token), [origin, token])

  return (
    <PageBody>
      <SetPageChrome breadcrumb={[{ label: t`Assistant` }]} manual="guide/coach" />
      <div className="flex max-w-4xl flex-col gap-4">
        <PageHeader
          title={t`Connect your assistant`}
          description={t`Every game you import is a fact the coach can query over MCP.`}
        />

        <McpKeys minted={minted} onMinted={setMinted} onDismiss={() => setMinted(null)} />

        <section data-tour="assistant" className="flex flex-col rounded-xl border border-line bg-panel">
          <div className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-3">
            <Bot className="size-3.5 text-faint" aria-hidden />
            <h2 className="text-xs font-semibold text-ink">
              <Trans>Connect a client</Trans>
            </h2>
            <div className="flex-1" />
            <span className="font-mono text-[0.625rem] text-dim">
              <Trans>streamable HTTP at /mcp</Trans>
            </span>
          </div>

          <div className="flex flex-col gap-4 px-3.5 py-3.5">
            <p className="text-[0.71875rem] leading-[1.5] text-dim">
              {minted ? (
                <Trans>These carry the key you just minted; copy them before you press Done.</Trans>
              ) : (
                <Trans>
                  Mint a key above and these fill in with it; until then the secret is a
                  placeholder to replace.
                </Trans>
              )}{' '}
              <Trans>Every client reads this database over the same URL your browser is on.</Trans>
            </p>

            <Snippet
              title="Claude Code"
              text={claudeCodeCommand(origin, token)}
              copyLabel={t`Copy command`}
            />

            <Snippet title="Codex" text={codexCommands(origin, token)} copyLabel={t`Copy commands`}>
              <Trans>
                Codex only takes the secret from an environment variable, never from the command
                line, so the first line sets one and the second names it.
              </Trans>
            </Snippet>

            <Snippet title={t`Any MCP client`} text={config} copyLabel={t`Copy config`}>
              <Trans>Drop this into the client&rsquo;s JSON config.</Trans>
            </Snippet>

            <p className="text-[0.6875rem] leading-[1.5] text-faint">
              <Trans>
                Where the deployment sets{' '}
                <span className="font-mono text-soft-2">BLUNDERBASE_MCP_BEARER_KEY</span> that key
                is accepted too, and so is your own password — a minted key is just the one that
                belongs in a file. <span className="font-mono text-soft-2">make mcp-key</span>{' '}
                prints the local URL and header.
              </Trans>
            </p>
          </div>
        </section>

        <p className="text-[0.6875rem] leading-[1.5] text-faint">
          <Trans>
            Nothing to query yet?{' '}
            <Link to="/library/import" className="text-accent-teal hover:text-accent-link">
              Import some games
            </Link>{' '}
            first — the coach only knows what the database holds.
          </Trans>
        </p>
      </div>
    </PageBody>
  )
}
