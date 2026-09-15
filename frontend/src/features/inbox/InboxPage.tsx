import { useState } from 'react'
import { Inbox, Plus, ShieldCheck } from 'lucide-react'

import { useT } from '@/i18n'

import { useProposals, useProjects } from '@/api/queries'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { SectionHeader } from '@/components/common/SectionHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ReindexButton } from '@/features/dashboard/ReindexButton'
import { DigestPanel } from '@/features/dashboard/DigestPanel'
import { TagsPanel } from '@/features/dashboard/TagsPanel'
import { StatsPanel } from '@/features/dashboard/StatsPanel'
import { ProposalCard } from '@/features/inbox/ProposalCard'
import { NewProjectDialog } from '@/features/projects/NewProjectDialog'
import { ProjectCard } from '@/features/projects/ProjectCard'

/**
 * Inbox: el dashboard de arranque.
 *
 * Izquierda, estado del workspace (totales + proyectos con su reparto por
 * categoría). Derecha, las confirmaciones que un agente dejó pendientes: aquí
 * el humano aprueba, redirige o descarta sin tocar el chat del agente.
 */
export function InboxPage() {
  const t = useT()
  // Las vencidas **no se borran al caducar**: su cuerpo sigue en la base hasta la
  // purga, y una persona todavía puede aprobarlas. Sin esta salida, quince
  // minutos de margen convertían una decisión tardía en trabajo perdido.
  const [showExpired, setShowExpired] = useState(false)
  const proposals = useProposals(showExpired ? 'expired' : 'pending')
  const projects = useProjects()
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  const pending = proposals.data ?? []

  return (
    <div className="grid h-full grid-cols-[21rem_minmax(0,1fr)]">
      <section className="min-h-0 space-y-4 overflow-y-auto border-r border-border p-3">
        <StatsPanel />
        <DigestPanel />
        <TagsPanel />

        <div className="space-y-2">
          <SectionHeader
            title={t('inbox.projects')}
            actions={
              <Button size="sm" variant="outline" onClick={() => setNewProjectOpen(true)}>
                <Plus className="size-3" />
                {t('inbox.newProject')}
              </Button>
            }
          />

          {projects.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : null}

          {projects.error ? (
            <ErrorPanel
              error={projects.error}
              title={t('inbox.projectsLoadFailed')}
              onRetry={() => {
                void projects.refetch()
              }}
            />
          ) : null}

          {projects.data?.length === 0 ? (
            <EmptyState
              icon={<Plus className="size-4" />}
              title={t('inbox.projectsEmpty.title')}
              hint={t('inbox.projectsEmpty.hint')}
              action={
                <Button size="sm" onClick={() => setNewProjectOpen(true)}>
                  {t('projects.newProject.submit')}
                </Button>
              }
            />
          ) : null}

          <div className="space-y-2">
            {projects.data?.map((project) => (
              <ProjectCard key={project.slug} project={project} />
            ))}
          </div>
        </div>
      </section>

      <section className="min-h-0 space-y-3 overflow-y-auto p-3">
        <SectionHeader
          title={showExpired ? t('inbox.pending.expiredTitle') : t('inbox.pending.title')}
          hint={
            pending.length > 0
              ? t('inbox.pending.waiting', { count: pending.length })
              : t(showExpired ? 'inbox.pending.noneExpired' : 'inbox.pending.none')
          }
          actions={
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant={showExpired ? 'ghost' : 'outline'}
                onClick={() => setShowExpired(false)}
              >
                {t('inbox.pending.tabPending')}
              </Button>
              <Button
                size="sm"
                variant={showExpired ? 'outline' : 'ghost'}
                onClick={() => setShowExpired(true)}
              >
                {t('inbox.pending.tabExpired')}
              </Button>
              <ReindexButton />
            </div>
          }
        />

        {proposals.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : null}

        {proposals.error ? (
          <ErrorPanel
            error={proposals.error}
            title={t('inbox.proposalsLoadFailed')}
            onRetry={() => {
              void proposals.refetch()
            }}
          />
        ) : null}

        {!proposals.isLoading && pending.length === 0 ? (
          <EmptyState
            className="py-12"
            icon={<Inbox className="size-5" />}
            title={t('inbox.empty.title')}
            hint={
              <>
                {t('inbox.empty.hintBefore')}{' '}
                <code>saveme_summary_propose</code>
                {t('inbox.empty.hintAfter')}
              </>
            }
            action={
              <span className="flex items-center gap-1 text-2xs text-secondary">
                <ShieldCheck className="size-3" />
                {t('inbox.empty.guarantee')}
              </span>
            }
          />
        ) : null}

        <div className="space-y-3">
          {pending.map((proposal) => (
            <ProposalCard key={proposal.token} proposal={proposal} />
          ))}
        </div>
      </section>

      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
    </div>
  )
}
