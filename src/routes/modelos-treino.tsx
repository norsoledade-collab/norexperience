import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  addDays,
  assignSequence,
  cloneBlocks,
  createSequence,
  formatDateBR,
  listActiveAssignments,
  listSequences,
  listStudents,
  nextTemplateName,
  todayIso,
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

function periodInfo(startedOn: string): { end: string; remaining: number } {
  const end = addDays(startedOn, 30);
  const diff = new Date(`${end}T00:00:00`).getTime() - new Date(`${todayIso()}T00:00:00`).getTime();
  return { end, remaining: Math.ceil(diff / 86_400_000) };
}

function ModelosTreinoPage() {
  const [sequences, setSequences] = useState<TrainingSequence[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [assignments, setAssignments] = useState<StudentSequenceRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TrainingSequence | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
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
      const id = await createSequence(name, [{ label: "Treino A", exercises: [] }]);
      await load();
      setSelectedId(id);
      setNotice(`Modelo ${name} criado. Agora é só montar os exercícios e salvar.`);
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
    const sequenceId = choices[student.id] ?? current?.sequence_id ?? selectedId ?? "";
    const sequence = sequences.find((item) => item.id === sequenceId);

    if (!sequence) {
      setError("Selecione um modelo antes de atribuir.");
      return;
    }

    if (current && current.sequence_id === sequence.id) {
      setNotice(`${student.full_name} já está com o modelo ${sequence.name}.`);
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await assignSequence(student.id, sequence);
      await load();
      setNotice(`Modelo ${sequence.name} atribuído para ${student.full_name}. Período de 30 dias iniciado.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atribuir o modelo.");
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
      const label = `Treino ${String.fromCharCode(65 + current.structures.length)}`;
      return { ...current, structures: [...current.structures, { label, exercises: [] }] };
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
          <p className="max-w-2xl text-sm text-muted-foreground">
            Monte os modelos fixos (Treino 1, Treino 2...) e escolha manualmente qual deles cada aluno
            deve seguir. Cada atribuição vale por 30 dias e só muda quando o treinador trocar.
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
              Nenhum modelo criado ainda. Use "Novo modelo" para montar o Treino 1.
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
                    setDraft((current) => (current ? { ...current, name: event.target.value } : current))
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
                  Adicionar bloco
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
                Nenhum bloco neste modelo. Use "Adicionar bloco" para começar.
              </p>
            )}

            {draft.structures.map((block, blockIndex) => (
              <div
                key={`bloco-${blockIndex}`}
                className="space-y-4 rounded-lg border border-border bg-background p-4"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <input
                    value={block.label}
                    onChange={(event) => updateBlock(blockIndex, { label: event.target.value })}
                    placeholder={`Treino ${String.fromCharCode(65 + blockIndex)}`}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-medium sm:max-w-xs"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => addExercise(blockIndex)}
                      className="rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
                    >
                      Adicionar exercício
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBlock(blockIndex)}
                      className="rounded-md border border-border px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                    >
                      Remover bloco
                    </button>
                  </div>
                </div>

                {block.exercises.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem exercícios neste bloco.</p>
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
            <h2 className="text-lg font-semibold">Alunos e modelos atribuídos</h2>
            <p className="text-sm text-muted-foreground">
              O modelo escolhido vale por 30 dias. A troca é sempre manual, feita pelo treinador.
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
                const info = assignment ? periodInfo(assignment.started_on) : null;
                const selectValue = choices[student.id] ?? assignment?.sequence_id ?? selectedId ?? "";

                return (
                  <div
                    key={student.id}
                    className="space-y-3 rounded-lg border border-border bg-background p-4"
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <p className="font-medium">{student.full_name}</p>
                      {assignment && info ? (
                        <p className="text-xs text-muted-foreground">
                          {assignment.sequence_name} · {formatDateBR(assignment.started_on)} até{" "}
                          {formatDateBR(info.end)} ·{" "}
                          {info.remaining > 0
                            ? `${info.remaining} dia(s) restantes`
                            : "período encerrado"}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Nenhum modelo atribuído</p>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row">
                      <select
                        value={selectValue}
                        onChange={(event) =>
                          setChoices((current) => ({ ...current, [student.id]: event.target.value }))
                        }
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm sm:max-w-xs"
                      >
                        <option value="">Selecione um modelo</option>
                        {sequences.map((sequence) => (
                          <option key={sequence.id} value={sequence.id}>
                            {sequence.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleAssign(student)}
                        disabled={busy}
                        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                      >
                        {assignment ? "Trocar modelo" : "Atribuir modelo"}
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
