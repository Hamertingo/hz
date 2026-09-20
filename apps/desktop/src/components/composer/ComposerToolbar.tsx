import { Plus } from "lucide-react";

import BranchSelector from "@/components/composer/BranchSelector";
import BranchSwitchDialog from "@/components/composer/BranchSwitchDialog";
import ContextMeter from "@/components/composer/ContextMeter";
import ModelSelector from "@/components/composer/ModelSelector";
import PermissionSelector, {
  offersPermissionModes,
} from "@/components/composer/PermissionSelector";
import ProjectSelector from "@/components/composer/ProjectSelector";
import RepoSelector from "@/components/composer/RepoSelector";
import AgentPicker from "@/components/composer/AgentPicker";
import StashBadge from "@/components/composer/StashBadge";
import WorktreeToggle from "@/components/composer/WorktreeToggle";
import { Button } from "@/components/ui/button";
import ShortcutKeys from "@/components/ShortcutKeys";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  AgentEvent,
  ApprovalPolicy,
  BranchList,
  ContextReading,
  Effort,
  Harness,
  Model,
  ModelId,
  Project,
  RepoSummary,
} from "@/types/events";

type ComposerToolbarProps = {
  /// Creation-time only, like project and branch: it decides which child runs.
  harness: Harness;

  models: Model[];
  modelId: ModelId;
  effort: Effort | null;
  /// Whether the session runs at its agent's faster tier. Sits beside the model
  /// rather than in a control of its own: it is per *model* on both agents that
  /// have one, so the picker that names the model is where it belongs.
  fast: boolean;
  onFastChange: (fast: boolean) => void;
  /// What the harness said about fast mode last turn, if it said anything.
  fastNote: string | null;
  onModelChange: (modelId: ModelId, effort: Effort | null) => void;
  onRefreshModels: () => void;
  onOpenProviderSettings?: () => void;
  loadingModels: boolean;

  permissionMode: ApprovalPolicy;
  onPermissionModeChange: (mode: ApprovalPolicy) => void;

  projects: Project[];
  projectPath: string | null;
  onSelectProject: (path: string) => void;
  onAttachProject: () => void;

  /// The repositories the project holds, and which one a new session runs in.
  /// Empty and `null` for a project that is itself a repository or that holds
  /// none, which is where the control draws nothing.
  repos: RepoSummary[];
  /// `null` is the project root — a workspace's whole-project target, and the
  /// ordinary answer for a project that is itself a repository.
  repoPath: string | null;
  onSelectRepo: (path: string | null) => void;
  /// Whether that target is a workspace's root rather than a repository. A root
  /// is not a repository, so the branch picker and the worktree toggle are both
  /// withheld for it.
  atWorkspaceRoot: boolean;

  branches: BranchList | null;
  branch: string | null;
  onSelectBranch: (branch: string) => void;

  /// The Agent a new session runs *as*. Creation-time like the project beside
  /// it: the runtime composes an Agent into a session when the session is made,
  /// so a session that already exists keeps the one it has and there is nothing
  /// here to switch.
  agentName: string | null;
  onAgentChange: (agentName: string | null) => void;

  /// Set while a switch waits on the uncommitted-changes prompt.
  pendingBranch: string | null;
  onConfirmBranchSwitch: (stash: boolean) => void;
  onCancelBranchSwitch: () => void;

  useWorktree: boolean;
  onToggleWorktree: () => void;

  /// Opens the file picker. The attachments themselves are held in a
  /// module-level store keyed by session, not passed through here — this row is
  /// handed to `ChatInput` as an opaque node, so the two cannot share props.
  onAttach: () => void;

  /// How full the model's context is, or `null` before any turn has reported
  /// it. Sits at the far end of the row rather than among the pickers: it
  /// reports rather than sets, and nothing here changes it.
  contextUsage: { used: number; max: number; costUsd: number | null } | null;

  /// The session's events, for the panel's own accounting. Read only while that
  /// panel is open — see `ContextMeter`.
  events: readonly AgentEvent[];

  /// The last context reading this session's agent gave, off its index entry.
  contextReading: ContextReading | null;

  /// The session whose agent is asked for a reading, or `null` before one exists.
  sessionId: string | null;

  /// Where the session runs is fixed at creation, so the last three controls
  /// only exist before one starts.
  isNewSession: boolean;
};

/// The composer's control row. Model and permission change a running session in
/// place; project, branch, and worktree decide where it starts and disappear
/// once it has — a control that can never be used is noise, and the session
/// header already shows the project and branch. Its own spacing from the card is
/// the caller's, since only the caller knows which side of it the row sits on.
export default function ComposerToolbar({
  harness,
  models,
  modelId,
  effort,
  fast,
  fastNote,
  onFastChange,
  onModelChange,
  onRefreshModels,
  onOpenProviderSettings,
  loadingModels,
  permissionMode,
  onPermissionModeChange,
  projects,
  projectPath,
  onSelectProject,
  onAttachProject,
  repos,
  repoPath,
  onSelectRepo,
  atWorkspaceRoot,
  branches,
  branch,
  onSelectBranch,
  agentName,
  onAgentChange,
  pendingBranch,
  onConfirmBranchSwitch,
  onCancelBranchSwitch,
  useWorktree,
  onToggleWorktree,
  onAttach,
  contextUsage,
  events,
  contextReading,
  sessionId,
  isNewSession,
}: ComposerToolbarProps) {
  return (
    <div className="flex min-w-0 items-center gap-0.5 px-1">
      {/* No radius override: `icon-sm` already carries the app's rounded-square,
          and a circle here would be the one round control in a row of them. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onAttach}
            aria-label="Attach files"
            className="text-muted-foreground"
          >
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          Attach files
          <ShortcutKeys ids={["attach"]} />
        </TooltipContent>
      </Tooltip>

      <StashBadge sessionId={sessionId} />

      <ModelSelector
        harness={harness}
        models={models}
        modelId={modelId}
        effort={effort}
        fast={fast}
        fastNote={fastNote}
        onFastChange={onFastChange}
        isNewSession={isNewSession}
        // The fan-out set is keyed by composer, exactly as the draft and the
        // attachments are — `null` before a session exists.
        sessionId={sessionId}
        onChange={onModelChange}
        onRefreshModels={onRefreshModels}
        onOpenProviderSettings={onOpenProviderSettings}
        loadingModels={loadingModels}
      />

      {isNewSession && (
        <>
          <ProjectSelector
            projects={projects}
            value={projectPath}
            onSelect={onSelectProject}
            onAttach={onAttachProject}
          />

          {/* Where the session runs, for a project that is a workspace: the
              whole project first, then the repositories inside it. Drawn only
              when there is more than one repository, so every project that is
              itself a repository is untouched — and it comes before the branch
              picker because the branches below belong to whatever is chosen
              here. */}
          {projectPath && (
            <RepoSelector
              rootPath={projectPath}
              repos={repos}
              value={repoPath}
              onSelect={onSelectRepo}
            />
          )}

          {/* Who runs this chat. It sits after the project and repository
              because those decide *where* the work happens, and this decides
              what the thing doing it is — the two are read as a sentence. */}
          <AgentPicker agentName={agentName} onSelect={onAgentChange} />

          {/* Both describe a repository, so neither means anything at a
              workspace root — which is not one. There is no branch to list and
              no tree to fork, and asking git for either is the pretence this
              picker exists to avoid; the root's session reaches the
              repositories by path instead, which is the whole point of it. */}
          {!atWorkspaceRoot && (
            <>
              <WorktreeToggle on={useWorktree} onToggle={onToggleWorktree} />

              {/* A worktree forks from the remote's default branch no matter
                  what is checked out, so offering a branch here would promise
                  something the CLI doesn't honour. State the real base instead. */}
              {useWorktree ? (
                branches?.defaultBase && (
                  <span className="truncate px-1.5 text-ui text-muted-foreground/60">
                    from {branches.defaultBase}
                  </span>
                )
              ) : (
                // Relative, so the switch popover anchors to the picker rather
                // than to the window.
                <div className="relative flex min-w-0 items-center">
                  <BranchSelector
                    branches={branches}
                    value={branch}
                    onSelect={onSelectBranch}
                    disabled={pendingBranch !== null}
                  />
                  <BranchSwitchDialog
                    target={pendingBranch}
                    dirty={branches?.dirty ?? 0}
                    onConfirm={onConfirmBranchSwitch}
                    onCancel={onCancelBranchSwitch}
                  />
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Last of the pickers: it is the one control here most sessions set once
          and never touch, so it sits furthest from where the eye lands. */}
      {offersPermissionModes(harness) && (
        <PermissionSelector
          harness={harness}
          value={permissionMode}
          onChange={onPermissionModeChange}
        />
      )}

      {/* `ml-auto` rather than a spacer, so a long branch name still gets the
          whole middle of the row and this stays pinned to the right edge.
          //
          **Drawn whether or not there is a number yet.** It used to wait for the
          first turn's occupancy, so a fresh composer had no meter at all and one
          appeared from nowhere mid-conversation — a control the reader has to
          notice rather than one that was always there. Nothing counted yet is a
          state it draws, and the first `usage_update` fills it in. */}
      <div className="ml-auto">
        {/* **Keyed by session, because a reading belongs to one.** The panel
            holds what its own ask fetched, and this row survives a session
            switch — unkeyed, the reading of the session the reader just left
            would be drawn as current under the one they just arrived at. */}
        <ContextMeter
          key={sessionId ?? "new"}
          sessionId={sessionId}
          used={contextUsage?.used ?? 0}
          max={contextUsage?.max ?? 0}
          costUsd={contextUsage?.costUsd ?? null}
          events={events}
          stored={contextReading}
        />
      </div>
    </div>
  );
}
