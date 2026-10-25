import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  PERIOD_DAYS,
  PERIOD_WEEKS,
  addExercisesToCurrentStructure,
  assignSequence,
  buildSchedule,
  cloneBlocks,
  computeProgress,
  createSequence,
  currentStructureAIContract,
  emptyBlock,
  formatDateBR,
  listActiveAssignments,
  listSequences,
  listStudents,
  nextTemplateName,
  structureAIContract,
  updateSequence,
  type SequenceBlock,
  type SequenceExercise,
  type StudentRow,
  type StudentSequenceRow,
  type TrainingSequence,
} from "@/lib/training-sequences";

export const Route = createFileRoute("/modelos-treino")({
  component: ModelosTreinoPage,
});

const newExercise = (): SequenceExercise => ({
  name: "",
  sets: 3,
  reps: "10-12",
  rest_seconds: 60,
  notes: "",
});

function ModelosTreinoPage() {
  const [sequences, setSequences] = useState<TrainingSequence[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [assignments, setAssignments] = useState<StudentSequenceRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TrainingSequence | null>(null);
  const [planChoices, setPlanChoices] = useState<Record<string, string>>({});
  const [startChoices, setStartChoices] = useState<Record<string, number>>({});
  const [aiExerciseDrafts, setAiExerciseDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [seqs, studs, assigns] = await Promise.all([
        listSequences(),
        listStudents(),
        listActiveAssignments(),
      ]);
      setSequences(seqs);
      setStudents(studs);
      setAssignments(assigns);
      setSelectedId((current) => {
        if (current && seqs.some((sequence) => sequence.id === current)) return current;
        return seqs[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar os modelos de treino.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const found = sequences.find((sequence) => sequence.id === selectedId) ?? null;
    setDraft(found ? { ...found, structures: cloneBlocks(found.structures) } : null);
  }, [selectedId, sequences]);

  const assignmentByStudent = useMemo(() => {
    const map = new Map<string, StudentSequenceRow>();
    assignments.forEach((row) => {
      if (!map.has(row.student_id)) map.set(row.student_id, row);
    });
    return map;
  }, [assignments]);

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const name = nextTemplateName(sequences);
      const id = await createSequence(name, [emptyBlock([])]);
      await load();
      setSelectedId(id);
      setNotice(
        `Modelo ${name} criado. Monte as estruturas Treino 1, Treino 2... na ordem em que o aluno deve cumpri-las.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o modelo.");
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateSequence(draft.id, draft.name.trim() || "Modelo sem nome", draft.structures);
      await load();
      setNotice("Modelo salvo.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o modelo.");
    } finally {
      setBusy(false);
    }
  };

  const handleAssign = async (student: StudentRow) => {
    const current = assignmentByStudent.get(student.id) ?? null;
    const planId = planChoices[student.id] ?? current?.sequence_id ?? selectedId ?? "";
    const sequence = sequences.find((item) => item.id === planId);

    if (!sequence) {
      setError("Selecione um modelo antes de atribuir.");
      return;
    }

    if (sequence.structures.length === 0) {
      setError("O modelo escolhido ainda não tem estruturas cadastradas.");
      return;
    }

    const fallbackStart =
      current && current.sequence_id === sequence.id ? current.start_index : 0;
    const startIndex = Math.min(
      Math.max(startChoices[student.id] ?? fallbackStart, 0),
      sequence.structures.length - 1,
    );
    const block = sequence.structures[startIndex];

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await assignSequence(student.id, sequence, startIndex);
      await load();
      setNotice(
        `${student.full_name} posicionado em ${block.label} do modelo ${sequence.name}. Cada estrutura vale ${PERIOD_WEEKS} semanas (${PERIOD_DAYS} dias) e o avanço é automático na ordem definida.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atribuir o modelo.");
    } finally {
      setBusy(false);
    }
  };

  const handleStructureExercise = async (student: StudentRow) => {
    const raw = (aiExerciseDrafts[student.id] ?? "").trim();

    if (!raw) {
      setError("Informe o exercício que a IA deve incluir na estrutura vigente.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await addExercisesToCurrentStructure(student.id, [
        { name: raw, sets: 3, reps: "10-12", rest_seconds: 60, notes: "" },
      ]);

      if (!result) {
        setError(`${student.full_name} não tem estrutura vigente para receber exercícios.`);
        return;
      }

      setAiExerciseDrafts((current) => ({ ...current, [student.id]: "" }));
      await load();
      setNotice(
        `Exercício incluído em ${result.block.label} de ${student.full_name}. Estrutura, divisão, regras e ordem das estruturas seguem como o treinador definiu.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível incluir o exercício.");
    } finally {
      setBusy(false);
    }
  };

  const updateBlock = (index: number, patch: Partial<SequenceBlock>) => {
    setDraft((current) => {
      if (!current) return current;
      const structures = current.structures.map((block, i) =>
        i === index ? { ...block, ...patch } : block,
      );
      return { ...current, structures };
    });
  };

  const addBlock = () => {
    setDraft((current) => {
      if (!current) return current;
      return { ...current, structures: [...current.structures, emptyBlock(current.structures)] };
    });
  };

  const moveBlock = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      if (!current) return current;
      const target = index + direction;
      if (target < 0 || target >= current.structures.length) return current;
      const structures = [...current.structures];
      const [moved] = structures.splice(index, 1);
      structures.splice(target, 0, moved);
      return { ...current, structures };
    });
  };

  const removeBlock = (index: number) => {
    setDraft((current) => {
      if (!current) return current;
      return { ...current, structures: current.structures.filter((_, i) => i !== index) };
    });
  };

  const addExercise = (blockIndex: number) => {
    setDraft((current) => {
      if (!current) return current;
      const structures = current.structures.map((block, i) =>
        i === blockIndex ? { ...block, exercises: [...block.exercises, newExercise()] } : block,
      );
      return { ...current, structures };
    });
  };

  const removeExercise = (blockIndex: number, exerciseIndex: number) => {
    setDraft((current) => {
      if (!current) return current;
      const structures = current.structures.map((block, i) =>
        i === blockIndex
          ? { ...block, exercises: block.exercises.filter((_, j) => j !== exerciseIndex) }
          : block,
      );
      return { ...current, structures };
    });
  };

  const updateExercise = (
    blockIndex: number,
    exerciseIndex: number,
    patch: Partial<SequenceExercise>,
  ) => {
    setDraft((current) => {
      if (!current) return current;
      const structures = current.structures.map((block, i) => {
        if (i !== blockIndex) return block;
        return {
          ...block,
          exercises: block.exercises.map((exercise, j) =>
            j === exerciseIndex ? { ...exercise, ...patch } : exercise,
          ),
        };
      });
      return { ...current, structures };
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-10">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Modelos de treino</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Monte a sequência fixa de estruturas (Treino 1, Treino 2, Treino 3...) com grupos
            musculares, divisão e regras. O aluno começa na estrutura escolhida pelo treinador e
            avança automaticamente para a próxima a cada {PERIOD_WEEKS} semanas ({PERIOD_DAYS}{" "}
            dias). Depois da última estrutura a sequência não reinicia: o aluno permanece nela até a
            troca manual.
          </p>
        </header>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {notice && (
          <div className="rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
            {notice}
          </div>
        )}

        <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">Modelos cadastrados</h2>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={busy}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              Novo modelo
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando modelos...</p>
          ) : sequences.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum modelo criado ainda. Use "Novo modelo" para montar a primeira sequência.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sequences.map((sequence) => (
                <button
                  key={sequence.id}
                  type="button"
                  onClick={() => setSelectedId(sequence.id)}
                  className={
                    selectedId === sequence.id
                      ? "rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                      : "rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
                  }
                >
                  {sequence.name}
                </button>
              ))}
            </div>
          )}
        </section>

        {draft && (
          <section className="space-y-5 rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="w-full space-y-1 sm:max-w-sm">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Nome do modelo
                </label>
                <input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, name: event.target.value } : current,
                    )
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={addBlock}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  Adicionar estrutura
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={busy}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  Salvar modelo
                </button>
              </div>
            </div>

            {draft.structures.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhuma estrutura neste modelo. Use "Adicionar estrutura" para criar o Treino 1.
              </p>
            )}

            {draft.structures.map((block, blockIndex) => (
              <div
                key={`estrutura-${blockIndex}`}
                className="space-y-4 rounded-lg border border-border bg-background p-4"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
                    <span className="w-fit rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                      {blockIndex + 1}ª na sequência
                    </span>
                    <input
                      value={block.label}
                      onChange={(event) => updateBlock(blockIndex, { label: event.target.value })}
                      placeholder={`Treino ${blockIndex + 1}`}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-medium sm:max-w-xs"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => moveBlock(blockIndex, -1)}
                      disabled={blockIndex === 0}
                      className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-40"
                    >
                      Subir
                    </button>
                    <button
                      type="button"
                      onClick={() => moveBlock(blockIndex, 1)}
                      disabled={blockIndex === draft.structures.length - 1}
                      className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-40"
                    >
                      Descer
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBlock(blockIndex)}
                      className="rounded-md border border-border px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                    >
                      Remover estrutura
                    </button>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Grupos musculares
                    </span>
                    <input
                      value={block.muscle_groups}
                      onChange={(event) =>
                        updateBlock(blockIndex, { muscle_groups: event.target.value })
                      }
                      placeholder="Peito, ombro e tríceps"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Divisão
                    </span>
                    <input
                      value={block.division}
                      onChange={(event) => updateBlock(blockIndex, { division: event.target.value })}
                      placeholder="Empurrar / puxar / pernas"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                </div>

                <label className="block space-y-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Regras
                  </span>
                  <textarea
                    value={block.rules}
                    onChange={(event) => updateBlock(blockIndex, { rules: event.target.value })}
                    placeholder="4 exercícios, 3 séries de 8-12, 60s de descanso"
                    className="min-h-[60px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                </label>

                <details className="rounded-md border border-border bg-muted/40 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                    Regras fixas enviadas à IA
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                    {structureAIContract(block)}
                  </pre>
                </details>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {block.exercises.length} exercício(s) nesta estrutura
                  </span>
                  <button
                    type="button"
                    onClick={() => addExercise(blockIndex)}
                    className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
                  >
                    Adicionar exercício
                  </button>
                </div>

                {block.exercises.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem exercícios nesta estrutura.</p>
                ) : (
                  <div className="space-y-2">
                    {block.exercises.map((exercise, exerciseIndex) => (
                      <div
                        key={`exercicio-${blockIndex}-${exerciseIndex}`}
                        className="grid gap-2 sm:grid-cols-[1fr_90px_100px_100px_auto] sm:items-center"
                      >
                        <input
                          value={exercise.name}
                          onChange={(event) =>
                            updateExercise(blockIndex, exerciseIndex, { name: event.target.value })
                          }
                          placeholder="Exercício"
                          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                        />
                        <input
                          type="number"
                          min={1}
                          value={exercise.sets}
                          onChange={(event) =>
                            updateExercise(blockIndex, exerciseIndex, {
                              sets: Number(event.target.value) || 0,
                            })
                          }
                          placeholder="Séries"
                          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                        />
                        <input
                          value={exercise.reps}
                          onChange={(event) =>
                            updateExercise(blockIndex, exerciseIndex, { reps: event.target.value })
                          }
                          placeholder="Reps"
                          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                        />
                        <input
                          type="number"
                          min={0}
                          value={exercise.rest_seconds}
                          onChange={(event) =>
                            updateExercise(blockIndex, exerciseIndex, {
                              rest_seconds: Number(event.target.value) || 0,
                            })
                          }
                          placeholder="Descanso"
                          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => removeExercise(blockIndex, exerciseIndex)}
                          className="rounded-md border border-border px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                        >
                          Remover
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Alunos e estrutura atual</h2>
            <p className="text-sm text-muted-foreground">
              Escolha o modelo e a estrutura inicial de cada aluno. O avanço para a próxima
              estrutura acontece sozinho a cada {PERIOD_DAYS} dias, na ordem definida no modelo.
            </p>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando alunos...</p>
          ) : students.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum aluno ativo encontrado.</p>
          ) : (
            <div className="space-y-3">
              {students.map((student) => {
                const assignment = assignmentByStudent.get(student.id) ?? null;
                const progress = assignment ? computeProgress(assignment) : null;
                const planId = planChoices[student.id] ?? assignment?.sequence_id ?? selectedId ?? "";
                const plannedSequence = sequences.find((item) => item.id === planId) ?? null;
                const options = plannedSequence?.structures ?? [];
                const fallbackStart =
                  assignment && assignment.sequence_id === planId ? assignment.start_index : 0;
                const startValue = Math.min(
                  Math.max(startChoices[student.id] ?? fallbackStart, 0),
                  Math.max(options.length - 1, 0),
                );

                return (
                  <div
                    key={student.id}
                    className="space-y-3 rounded-lg border border-border bg-background p-4"
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <p className="font-medium">{student.full_name}</p>
                      {assignment ? (
                        <p className="text-xs text-muted-foreground">
                          Modelo: {assignment.sequence_name}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Nenhum modelo atribuído</p>
                      )}
                    </div>

                    {progress && progress.block && (
                      <div className="space-y-1 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                        <p className="text-sm font-semibold text-foreground">
                          {progress.block.label}
                          {progress.block.muscle_groups ? ` · ${progress.block.muscle_groups}` : ""}
                        </p>
                        {progress.block.division && <p>Divisão: {progress.block.division}</p>}
                        {progress.block.rules && <p>Regras: {progress.block.rules}</p>}
                        <p>
                          Período: {formatDateBR(progress.period_start)} até{" "}
                          {formatDateBR(progress.period_end)} ·{" "}
                          {progress.finished
                            ? "sequência concluída"
                            : progress.days_remaining > 0
                              ? `${progress.days_remaining} dia(s) restantes`
                              : "período encerrado"}
                        </p>
                        {progress.next_block && progress.passes_on && (
                          <p>
                            Próxima estrutura: {progress.next_block.label} a partir de{" "}
                            {formatDateBR(progress.passes_on)}
                          </p>
                        )}
                        {progress.is_last && !progress.next_block && (
                          <p>
                            Última estrutura da sequência — o aluno permanece nela até o treinador
                            trocar o modelo.
                          </p>
                        )}
                      </div>
                    )}

                    {progress && progress.block && (
                      <div className="space-y-2 rounded-md border border-border px-3 py-2">
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                            Cronograma das estruturas ({PERIOD_WEEKS} semanas cada)
                          </summary>
                          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                            {(assignment ? buildSchedule(assignment) : []).map((entry) => (
                              <li key={`cronograma-${entry.index}`}>
                                {entry.index + 1}. {entry.block.label} ·{" "}
                                {formatDateBR(entry.period_start)} até{" "}
                                {formatDateBR(entry.period_end)} · {entry.status}
                              </li>
                            ))}
                          </ul>
                        </details>

                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                            Regras fixas da estrutura vigente enviadas à IA
                          </summary>
                          <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                            {currentStructureAIContract(progress)}
                          </pre>
                        </details>

                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <input
                            value={aiExerciseDrafts[student.id] ?? ""}
                            onChange={(event) =>
                              setAiExerciseDrafts((current) => ({
                                ...current,
                                [student.id]: event.target.value,
                              }))
                            }
                            placeholder={`Exercício para ${progress.block.label} (grupos: ${progress.block.muscle_groups || "definir no modelo"})`}
                            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => void handleStructureExercise(student)}
                            disabled={busy}
                            className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
                          >
                            Incluir na estrutura vigente
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <select
                        value={planId}
                        onChange={(event) => {
                          const value = event.target.value;
                          setPlanChoices((current) => ({ ...current, [student.id]: value }));
                          setStartChoices((current) => {
                            const next = { ...current };
                            delete next[student.id];
                            return next;
                          });
                        }}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      >
                        <option value="">Selecione um modelo</option>
                        {sequences.map((sequence) => (
                          <option key={sequence.id} value={sequence.id}>
                            {sequence.name}
                          </option>
                        ))}
                      </select>

                      <select
                        value={String(startValue)}
                        onChange={(event) =>
                          setStartChoices((current) => ({
                            ...current,
                            [student.id]: Number(event.target.value) || 0,
                          }))
                        }
                        disabled={options.length === 0}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
                      >
                        {options.length === 0 ? (
                          <option value="0">Sem estruturas no modelo</option>
                        ) : (
                          options.map((block, index) => (
                            <option key={`${block.label}-${index}`} value={index}>
                              {`${index + 1}. ${block.label}`}
                            </option>
                          ))
                        )}
                      </select>

                      <button
                        type="button"
                        onClick={() => void handleAssign(student)}
                        disabled={busy || options.length === 0}
                        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                      >
                        {assignment && assignment.sequence_id === planId
                          ? "Reposicionar aluno"
                          : "Atribuir modelo"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
