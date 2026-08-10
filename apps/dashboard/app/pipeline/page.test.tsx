import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { change, render, submit } from '../../test/render';
import PipelinePage from './page';

const getPipelineJobMock = vi.fn();

vi.mock('../../lib/api', () => ({
  getPipelineJob: (...args: unknown[]) => getPipelineJobMock(...args),
}));

beforeEach(() => {
  getPipelineJobMock.mockReset();
  sessionStorage.clear();
});

describe('PipelinePage', () => {
  it('consulta um job existente sem expor criacao de pipeline', async () => {
    getPipelineJobMock.mockResolvedValue({
      status: 'completed',
      progress: 100,
      startedAt: '2026-07-24T10:00:00.000Z',
      finishedAt: '2026-07-24T10:00:01.000Z',
      result: { ok: true },
      error: null,
    });

    const screen = await render(<PipelinePage />);
    const input = screen.container.querySelector('input[placeholder="Cole o jobId"]');
    const form = screen.container.querySelector('form');
    expect(input).not.toBeNull();
    expect(form).not.toBeNull();
    expect(screen.container.textContent).not.toContain('Executar pipeline');

    await change(input as HTMLInputElement, 'job-1');
    await submit(form as HTMLFormElement);

    expect(getPipelineJobMock).toHaveBeenCalledWith('job-1');
    expect(sessionStorage.getItem('lastPipelineJobId')).toBe('job-1');
    expect(screen.container.textContent).toContain('completed');
    await screen.unmount();
  });

  it('faz polling enquanto ativo e limpa o intervalo ao desmontar', async () => {
    vi.useFakeTimers();
    getPipelineJobMock.mockResolvedValue({
      status: 'active',
      progress: 30,
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
    });

    const screen = await render(<PipelinePage />);
    const input = screen.container.querySelector('input[placeholder="Cole o jobId"]');
    const form = screen.container.querySelector('form');
    await change(input as HTMLInputElement, 'job-2');
    await submit(form as HTMLFormElement);
    expect(getPipelineJobMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(getPipelineJobMock).toHaveBeenCalledTimes(2);

    await screen.unmount();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(getPipelineJobMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('mostra erro quando a consulta falha', async () => {
    getPipelineJobMock.mockRejectedValue(new Error('Job nao encontrado'));

    const screen = await render(<PipelinePage />);
    const input = screen.container.querySelector('input[placeholder="Cole o jobId"]');
    const form = screen.container.querySelector('form');
    await change(input as HTMLInputElement, 'job-3');
    await submit(form as HTMLFormElement);

    expect(screen.container.textContent).toContain('Job nao encontrado');
    await screen.unmount();
  });
});
