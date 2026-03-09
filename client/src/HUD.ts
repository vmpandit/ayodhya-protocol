// ── Ayodhya Protocol: Lanka Reforged ── HUD Manager ──
// Polish pass: kill feed, combo counter, screen transitions, settings panel.
// Expanded: dialogue system, meditation bar, Lakshman choice, companion notifications.

import { PlayerState, BossState, BossPhase, PlayerStatus, SpecialArrowType } from '@shared/types';
import { DialogueNode, DialogueChoice } from './DialogueTrees';

export class HUD {
  private hpBar: HTMLElement;
  private hpLabel: HTMLElement;
  private staminaBar: HTMLElement;
  private staminaLabel: HTMLElement;
  private bossBar: HTMLElement;
  private bossHpFill: HTMLElement;
  private bossPhaseLabel: HTMLElement;
  private teamBarsContainer: HTMLElement;
  private cdFireOverlay: HTMLElement;
  private cdShockwaveOverlay: HTMLElement;
  private downedOverlay: HTMLElement;
  private gameOverScreen: HTMLElement;
  private gameOverTitle: HTMLElement;
  private notifications: HTMLElement;
  private damageVignette: HTMLElement;
  private killFeed: HTMLElement;
  private comboEl: HTMLElement;
  private comboCountEl: HTMLElement;
  private arrowAlert: HTMLElement;
  private arrowSelector: HTMLElement;
  private arrowSlots: HTMLElement[] = [];
  private ammoLabel: HTMLElement | null;
  private chapterOverlay: HTMLElement | null;
  private dialogueOverlay: HTMLElement | null;
  private meditationBar: HTMLElement | null;
  private meditationFill: HTMLElement | null;
  private meditationHint: HTMLElement | null;
  private lakshmanChoiceEl: HTMLElement | null;
  private goalWidget: HTMLElement | null;
  private goalText: HTMLElement | null;
  private talkPrompt: HTMLElement | null;
  private dialogueChoicesContainer: HTMLElement | null;
  private dialogueHint: HTMLElement | null;
  private tutorialChecklist: HTMLElement | null;
  private backstoryOverlay: HTMLElement | null;
  private renderCanvas: HTMLElement | null;

  // ── Dialogue choice callback ──────────────────────────────
  public onChoiceSelected: (index: number) => void = () => {};

  // ── Combo tracking ────────────────────────────────────────
  private comboCount = 0;
  private comboTimer = 0;
  private readonly COMBO_WINDOW = 3.0; // seconds to maintain combo

  // ── Arrow alert ────────────────────────────────────────────
  private alertTimer = 0;

  // ── Dialogue queue for multi-line conversations ────────────
  private dialogueQueue: { name: string; message: string }[] = [];
  private dialogueAutoTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.hpBar = document.getElementById('hpBar')!;
    this.hpLabel = document.getElementById('hpLabel')!;
    this.staminaBar = document.getElementById('staminaBar')!;
    this.staminaLabel = document.getElementById('staminaLabel')!;
    this.bossBar = document.getElementById('bossBar')!;
    this.bossHpFill = document.getElementById('bossHpFill')!;
    this.bossPhaseLabel = document.getElementById('bossPhaseLabel')!;
    this.teamBarsContainer = document.getElementById('teamBars')!;
    this.cdFireOverlay = document.getElementById('cdFireOverlay')!;
    this.cdShockwaveOverlay = document.getElementById('cdShockwaveOverlay')!;
    this.downedOverlay = document.getElementById('downedOverlay')!;
    this.gameOverScreen = document.getElementById('gameOverScreen')!;
    this.gameOverTitle = document.getElementById('gameOverTitle')!;
    this.notifications = document.getElementById('notifications')!;
    this.damageVignette = document.getElementById('damageVignette')!;
    this.killFeed = document.getElementById('killFeed')!;
    this.comboEl = document.getElementById('comboDisplay')!;
    this.comboCountEl = document.getElementById('comboCount')!;
    this.arrowAlert = document.getElementById('arrowAlert')!;
    this.arrowSelector = document.getElementById('arrowSelector')!;
    this.ammoLabel = document.getElementById('ammoCount');
    this.chapterOverlay = document.getElementById('chapterOverlay');
    this.dialogueOverlay = document.getElementById('dialogueOverlay');
    this.meditationBar = document.getElementById('meditationBar');
    this.meditationFill = document.getElementById('meditationFill');
    this.meditationHint = document.getElementById('meditationHint');
    this.lakshmanChoiceEl = document.getElementById('lakshmanChoice');
    this.goalWidget = document.getElementById('goalWidget');
    this.goalText = document.getElementById('goalText');
    this.talkPrompt = document.getElementById('talkPrompt');
    this.dialogueChoicesContainer = document.getElementById('dialogueChoices');
    this.dialogueHint = document.getElementById('dialogueHint');
    this.tutorialChecklist = document.getElementById('tutorialChecklist');
    this.backstoryOverlay = document.getElementById('backstoryOverlay');
    this.renderCanvas = document.getElementById('renderCanvas');

    // Cache arrow slot elements
    for (let i = 0; i < 5; i++) {
      const slot = document.getElementById(`arrowSlot${i}`);
      if (slot) this.arrowSlots.push(slot);
    }

    // Setup dialogue choice click handlers
    if (this.dialogueChoicesContainer) {
      const choiceButtons = this.dialogueChoicesContainer.querySelectorAll('.dialogue-choice');
      choiceButtons.forEach((btn, index) => {
        btn.addEventListener('click', () => {
          this.onChoiceSelected(index);
        });
      });

      // Setup keyboard handlers for choice selection (1/2/3 keys)
      window.addEventListener('keydown', (e) => {
        if (!this.dialogueChoicesContainer?.classList.contains('visible')) return;
        const num = parseInt(e.key);
        if (num >= 1 && num <= 3) {
          this.onChoiceSelected(num - 1);
        }
      });
    }
  }

  /** Call every frame to decay combo timer and arrow alert */
  update(dt: number): void {
    if (this.comboCount > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
        this.comboEl.classList.remove('visible');
      }
    }
    // Decay arrow alert
    if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      if (this.alertTimer <= 0) {
        this.arrowAlert.classList.remove('visible');
      }
    }
  }

  showBlessingReceived(name: string, description: string): void {
    const el = document.getElementById('blessingNotification');
    const nameEl = document.getElementById('blessingName');
    const descEl = document.getElementById('blessingDesc');
    if (el && nameEl && descEl) {
      nameEl.textContent = name;
      descEl.textContent = description;
      el.style.opacity = '1';
      setTimeout(() => { el.style.opacity = '0'; }, 4000);
    }
  }

  updateDharmaGrace(active: boolean): void {
    const el = document.getElementById('dharmaGrace');
    if (el) el.style.opacity = active ? '1' : '0';
  }

  updatePlayerBars(hp: number, maxHp: number, stamina: number): void {
    const hpPct = Math.max(0, (hp / maxHp) * 100);
    const prevHpPct = parseFloat(this.hpBar.style.width) || 100;

    // Damage flash effect: briefly show red before transitioning
    if (hpPct < prevHpPct) {
      this.hpBar.style.background = 'linear-gradient(90deg, #ff0000, #ff6666)';
      this.hpBar.style.boxShadow = 'inset 0 1px 2px rgba(255,255,255,0.1), 0 0 12px rgba(255,0,0,0.8)';
      setTimeout(() => {
        this.hpBar.style.background = 'linear-gradient(90deg, #c0392b, #e74c3c)';
        this.hpBar.style.boxShadow = 'inset 0 1px 2px rgba(255,255,255,0.1)';
      }, 150);
    }

    this.hpBar.style.width = `${hpPct}%`;
    this.hpLabel.textContent = `${Math.round(hp)} / ${Math.round(maxHp)}`;

    // Low health pulse
    if (hpPct <= 25) {
      this.hpBar.style.animation = 'lowHpPulse 0.6s infinite';
    } else {
      this.hpBar.style.animation = '';
    }

    const stPct = Math.max(0, (stamina / 100) * 100);
    this.staminaBar.style.width = `${stPct}%`;
    this.staminaLabel.textContent = `${Math.round(stamina)} / 100`;
  }

  updateTeamBars(players: PlayerState[], localId: number): void {
    const others = players.filter(p => p.id !== localId);

    while (this.teamBarsContainer.children.length < others.length) {
      const bar = document.createElement('div');
      bar.className = 'team-bar';
      bar.innerHTML = `
        <div class="team-name">P?</div>
        <div class="team-hp"><div class="team-hp-fill"></div></div>
      `;
      this.teamBarsContainer.appendChild(bar);
    }
    while (this.teamBarsContainer.children.length > others.length) {
      this.teamBarsContainer.removeChild(this.teamBarsContainer.lastChild!);
    }

    for (let i = 0; i < others.length; i++) {
      const p = others[i];
      const el = this.teamBarsContainer.children[i] as HTMLElement;
      const name = el.querySelector('.team-name') as HTMLElement;
      const fill = el.querySelector('.team-hp-fill') as HTMLElement;
      name.textContent = `P${p.id}`;
      const pct = Math.max(0, (p.hp / p.maxHp) * 100);
      fill.style.width = `${pct}%`;
      fill.style.background = p.status === PlayerStatus.Downed ? '#ff4444' : '#2ecc71';
    }
  }

  updateBossBar(boss: BossState): void {
    this.bossBar.classList.add('visible');
    const pct = Math.max(0, (boss.hp / boss.maxHp) * 100);
    this.bossHpFill.style.width = `${pct}%`;

    const phaseNames: Record<number, string> = {
      [BossPhase.Phase1]: 'Phase I',
      [BossPhase.Phase2]: 'Phase II — Ascended',
      [BossPhase.Phase3Enrage]: 'Phase III — ENRAGE',
      [BossPhase.Dead]: 'DEFEATED',
    };
    this.bossPhaseLabel.textContent = phaseNames[boss.phase] || '';

    if (boss.phase === BossPhase.Phase3Enrage) {
      this.bossHpFill.style.background = 'linear-gradient(90deg, #8b0000, #ff0000)';
      this.bossPhaseLabel.style.color = '#ff4444';
    } else {
      this.bossHpFill.style.background = 'linear-gradient(90deg, #8b0000, #ff4444)';
      this.bossPhaseLabel.style.color = '#ff8888';
    }
  }

  updateCooldowns(fireArrowPct: number, shockwavePct: number): void {
    this.cdFireOverlay.style.height = `${fireArrowPct * 100}%`;
    this.cdShockwaveOverlay.style.height = `${shockwavePct * 100}%`;
  }

  updateDownedState(isDowned: boolean): void {
    if (isDowned) {
      this.downedOverlay.classList.add('visible');
    } else {
      this.downedOverlay.classList.remove('visible');
    }
  }

  flashDamage(): void {
    this.damageVignette.classList.remove('flash');
    void this.damageVignette.offsetWidth;
    this.damageVignette.classList.add('flash');
  }

  triggerScreenShake(): void {
    if (!this.renderCanvas) return;
    this.renderCanvas.classList.add('shaking');
    setTimeout(() => {
      this.renderCanvas?.classList.remove('shaking');
    }, 150);
  }

  /** Increment combo counter (call when player lands a hit on enemy/boss). */
  registerHit(): void {
    this.comboCount++;
    this.comboTimer = this.COMBO_WINDOW;
    this.comboCountEl.textContent = `${this.comboCount}`;
    this.comboEl.classList.add('visible');

    // Pulse animation
    this.comboCountEl.classList.remove('pop');
    void this.comboCountEl.offsetWidth;
    this.comboCountEl.classList.add('pop');
  }

  /** Add a message to the kill feed. */
  addKillFeedEntry(text: string, color = '#ffd700'): void {
    const entry = document.createElement('div');
    entry.className = 'kill-feed-entry';
    entry.textContent = text;
    entry.style.color = color;
    this.killFeed.appendChild(entry);

    // Remove after animation ends
    setTimeout(() => entry.remove(), 4000);

    // Max 5 entries visible
    while (this.killFeed.children.length > 5) {
      this.killFeed.removeChild(this.killFeed.firstChild!);
    }
  }

  showNotification(text: string): void {
    const el = document.createElement('div');
    el.className = 'notif';
    el.textContent = text;
    this.notifications.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }

  showGameOver(won: boolean): void {
    this.gameOverScreen.classList.add('visible');
    this.gameOverTitle.textContent = won ? 'VICTORY' : 'DEFEAT';
    this.gameOverTitle.className = won ? 'victory' : 'defeat';
    // Play background video if available
    const vid = document.getElementById('gameOverVideo') as HTMLVideoElement;
    if (vid) {
      vid.src = won ? 'video/victory_bg.mp4' : 'video/defeat_bg.mp4';
      vid.play().catch(() => {}); // Silently fail if video not found
    }
  }

  /** Get current combo count for scoring/feedback. */
  getComboCount(): number { return this.comboCount; }

  /** Flash an enemy special arrow alert on screen. */
  showArrowAlert(arrowName: string): void {
    this.arrowAlert.textContent = `\u26A0 ${arrowName} INCOMING!`;
    this.arrowAlert.classList.add('visible');
    this.alertTimer = 1.5; // seconds
  }

  /** Update the special arrow selector bar to highlight the selected arrow. */
  updateArrowSelector(selected: SpecialArrowType, cooldowns: number[]): void {
    for (let i = 0; i < this.arrowSlots.length; i++) {
      const slot = this.arrowSlots[i];
      slot.classList.toggle('selected', i === (selected as number));
      const cdOverlay = slot.querySelector('.arrow-cd-fill') as HTMLElement;
      if (cdOverlay) {
        cdOverlay.style.height = `${(cooldowns[i] || 0) * 100}%`;
      }
    }
  }

  updateAmmo(current: number, max: number): void {
    if (this.ammoLabel) {
      this.ammoLabel.textContent = `\uD83C\uDFF9 ${current}/${max}`;
      this.ammoLabel.style.color = current <= 5 ? '#ff4444' : current <= 15 ? '#ffaa00' : '#ffffff';
    }
  }

  showChapterBanner(chapter: number, title: string, subtitle: string): void {
    if (!this.chapterOverlay) return;
    const chapterNum = this.chapterOverlay.querySelector('.chapter-num') as HTMLElement;
    const chapterTitle = this.chapterOverlay.querySelector('#chapterTitle') as HTMLElement;
    const chapterSub = this.chapterOverlay.querySelector('#chapterSubtitle') as HTMLElement;

    if (chapterNum) chapterNum.textContent = `Chapter ${chapter}`;
    if (chapterTitle) chapterTitle.textContent = title;
    if (chapterSub) chapterSub.textContent = subtitle;

    this.chapterOverlay.classList.add('visible');

    // Fade out after 4 seconds with cinematic effect
    setTimeout(() => {
      this.chapterOverlay?.classList.remove('visible');
    }, 4000);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  DIALOGUE SYSTEM (ally NPC conversations)
  // ══════════════════════════════════════════════════════════════════════════

  /** Show a single dialogue line (auto-hides after duration). */
  showDialogue(name: string, message: string, durationMs = 8000): void {
    if (!this.dialogueOverlay) return;
    const nameEl = this.dialogueOverlay.querySelector('.dialogue-name') as HTMLElement;
    const msgEl = this.dialogueOverlay.querySelector('.dialogue-message') as HTMLElement;

    if (nameEl) nameEl.textContent = name;
    if (msgEl) msgEl.textContent = message;

    this.dialogueOverlay.classList.add('visible');

    // Clear any pending auto-hide
    if (this.dialogueAutoTimer) clearTimeout(this.dialogueAutoTimer);
    this.dialogueAutoTimer = setTimeout(() => {
      this.dialogueOverlay?.classList.remove('visible');
      // Show next queued dialogue if any
      this.advanceDialogueQueue();
    }, durationMs);
  }

  /**
   * Queue multiple dialogue lines for a conversation.
   * Each line is shown sequentially with the given per-line duration.
   */
  showDialogueSequence(lines: { name: string; message: string }[], perLineDurationMs = 7000): void {
    if (lines.length === 0) return;
    this.dialogueQueue = lines.slice(1); // everything after the first
    // Show the first line immediately
    this.showDialogue(lines[0].name, lines[0].message, perLineDurationMs);
  }

  private advanceDialogueQueue(): void {
    if (this.dialogueQueue.length === 0) return;
    const next = this.dialogueQueue.shift()!;
    // Small delay between lines for cinematic pacing
    setTimeout(() => {
      this.showDialogue(next.name, next.message, 7000);
    }, 600);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  MEDITATION UI
  // ══════════════════════════════════════════════════════════════════════════

  showMeditationBar(): void {
    if (this.meditationBar) this.meditationBar.classList.add('visible');
  }

  hideMeditationBar(): void {
    if (this.meditationBar) this.meditationBar.classList.remove('visible');
    if (this.meditationFill) this.meditationFill.style.width = '0%';
  }

  updateMeditationBar(progress: number): void {
    if (this.meditationFill) {
      this.meditationFill.style.width = `${Math.min(100, progress * 100)}%`;
    }
  }

  updateMeditationHint(canMeditate: boolean): void {
    if (this.meditationHint) {
      if (canMeditate) {
        this.meditationHint.classList.add('visible');
      } else {
        this.meditationHint.classList.remove('visible');
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  LAKSHMAN CHOICE UI
  // ══════════════════════════════════════════════════════════════════════════

  showLakshmanChoice(): void {
    if (this.lakshmanChoiceEl) this.lakshmanChoiceEl.classList.add('visible');
  }

  hideLakshmanChoice(): void {
    if (this.lakshmanChoiceEl) this.lakshmanChoiceEl.classList.remove('visible');
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  COMPANION NOTIFICATIONS
  // ══════════════════════════════════════════════════════════════════════════

  showCompanionJoined(name: string): void {
    this.addKillFeedEntry(`${name} has joined your quest!`, '#90ee90');
    this.showNotification(`${name.toUpperCase()} JOINS`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  GOAL WIDGET
  // ══════════════════════════════════════════════════════════════════════════

  showGoal(description: string): void {
    if (this.goalText) this.goalText.textContent = description;
    if (this.goalText) this.goalText.classList.remove('completed');
    if (this.goalWidget) this.goalWidget.classList.add('visible');
  }

  completeGoal(): void {
    if (this.goalText) this.goalText.classList.add('completed');
    // Hide after 3 seconds
    setTimeout(() => {
      this.goalWidget?.classList.remove('visible');
    }, 3000);
  }

  hideGoal(): void {
    if (this.goalWidget) this.goalWidget.classList.remove('visible');
  }

  /** Show goal revealed with a notification animation */
  showGoalRevealed(description: string): void {
    this.showGoal(description);
    // Also show a notification
    this.showNotification('GOAL REVEALED');
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  DIALOGUE CHOICE SYSTEM
  // ══════════════════════════════════════════════════════════════════════════

  showDialogueNode(node: DialogueNode, isEnd: boolean): void {
    if (!this.dialogueOverlay) return;

    const nameEl = this.dialogueOverlay.querySelector('.dialogue-name') as HTMLElement;
    const msgEl = this.dialogueOverlay.querySelector('.dialogue-message') as HTMLElement;

    if (nameEl) nameEl.textContent = node.speaker;
    if (msgEl) msgEl.textContent = node.text;

    this.dialogueOverlay.classList.add('visible');

    // Always clean previous choices first
    this.hideDialogueChoices();

    // Show choices if available
    if (node.choices && node.choices.length > 0) {
      this.showDialogueChoices(node.choices);
      // Flash conversation hint
      this.showDialogueHint('Choose a response below (click or press 1-' + node.choices.length + ')');
    } else if (isEnd) {
      // Show end-of-dialogue continue button in the choices area
      this.showEndDialogueButton();
      this.showDialogueHint('Press SPACE to continue');
    }
  }

  private showDialogueChoices(choices: DialogueChoice[]): void {
    if (!this.dialogueChoicesContainer) return;

    // Clear previous choices
    this.dialogueChoicesContainer.innerHTML = '';

    // Add header instruction
    const header = document.createElement('div');
    header.className = 'dialogue-choice-header';
    header.textContent = 'Choose a response (click or press 1-' + choices.length + ')';
    this.dialogueChoicesContainer.appendChild(header);

    // Create choice buttons with number badges
    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i];
      const btn = document.createElement('div');
      btn.className = 'dialogue-choice';
      btn.setAttribute('data-index', i.toString());
      btn.innerHTML = `<span class="choice-num">${i + 1}</span><span>${choice.label}</span>`;
      this.dialogueChoicesContainer.appendChild(btn);

      btn.addEventListener('click', () => {
        this.onChoiceSelected(i);
      });
    }

    this.dialogueChoicesContainer.style.display = 'block';
    this.dialogueChoicesContainer.classList.add('visible');
  }

  hideDialogueChoices(): void {
    if (this.dialogueChoicesContainer) {
      this.dialogueChoicesContainer.classList.remove('visible');
      this.dialogueChoicesContainer.style.display = 'none';
      this.dialogueChoicesContainer.innerHTML = '';
    }
  }

  hideDialogue(): void {
    if (this.dialogueOverlay) {
      this.dialogueOverlay.classList.remove('visible');
    }
    this.hideDialogueChoices();
  }

  private showEndDialogueButton(): void {
    if (!this.dialogueChoicesContainer) return;
    this.dialogueChoicesContainer.innerHTML = '';

    const hint = document.createElement('div');
    hint.className = 'dialogue-end-hint';
    hint.textContent = 'Press SPACE to continue';
    hint.addEventListener('click', () => {
      this.onEndDialogue();
    });
    this.dialogueChoicesContainer.appendChild(hint);

    this.dialogueChoicesContainer.style.display = 'block';
    this.dialogueChoicesContainer.classList.add('visible');
  }

  private showDialogueHint(text: string): void {
    if (!this.dialogueHint) return;
    this.dialogueHint.textContent = text;
    this.dialogueHint.classList.add('visible');
    setTimeout(() => {
      this.dialogueHint?.classList.remove('visible');
    }, 2500);
  }

  /** Callback for ending dialogue (Space key or click continue) */
  public onEndDialogue: () => void = () => {};

  showTalkPrompt(npcName: string): void {
    if (!this.talkPrompt) return;
    this.talkPrompt.textContent = `Press F to talk to ${npcName}`;
    this.talkPrompt.classList.add('visible');
  }

  hideTalkPrompt(): void {
    if (this.talkPrompt) {
      this.talkPrompt.classList.remove('visible');
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  TUTORIAL SYSTEM
  // ══════════════════════════════════════════════════════════════════════════

  showTutorialChecklist(): void {
    if (this.tutorialChecklist) {
      this.tutorialChecklist.classList.add('visible');
    }
  }

  hideTutorialChecklist(): void {
    if (this.tutorialChecklist) {
      this.tutorialChecklist.classList.remove('visible');
    }
  }

  showTutorialStep(step: string, completed: boolean): void {
    if (!this.tutorialChecklist) return;
    const stepEl = this.tutorialChecklist.querySelector(`[data-step="${step}"]`);
    if (stepEl) {
      const checkMark = stepEl.querySelector('.tut-check') as HTMLElement;
      if (checkMark) {
        checkMark.textContent = completed ? '✓' : '○';
      }
      if (completed) {
        stepEl.classList.add('done');
      }
    }
  }

  showTutorialComplete(): void {
    this.showNotification('TUTORIAL COMPLETE — The story begins...');
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  BACKSTORY CUTSCENE
  // ══════════════════════════════════════════════════════════════════════════

  showBackstorySlide(speaker: string, text: string, isLast: boolean): void {
    if (!this.backstoryOverlay) return;

    const speakerEl = this.backstoryOverlay.querySelector('.backstory-speaker') as HTMLElement;
    const textEl = this.backstoryOverlay.querySelector('.backstory-text') as HTMLElement;
    const continueEl = this.backstoryOverlay.querySelector('.backstory-continue') as HTMLElement;

    if (speakerEl) speakerEl.textContent = speaker;
    if (textEl) textEl.textContent = text;
    if (continueEl) {
      continueEl.textContent = isLast ? 'Press Space to begin the battle' : 'Press Space to continue';
    }

    this.backstoryOverlay.classList.add('visible');
  }

  hideBackstory(): void {
    if (this.backstoryOverlay) {
      this.backstoryOverlay.classList.remove('visible');
    }
  }
}
