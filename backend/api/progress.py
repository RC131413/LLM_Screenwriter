"""Small, read-only progress snapshots derived from recorded workflow events."""


def generation_progress(run, executions=None):
    executions = list(run.agent_executions.all()) if executions is None else executions
    rows = []
    for execution in executions:
        number = execution.input_payload.get('variant_number', 1)
        number = number if type(number) is int and 1 <= number <= 3 else 1
        interrupted = run.status in {'failed', 'cancelled'} and execution.status in {'pending', 'running'}
        finished = run.finished_at if interrupted else execution.finished_at
        duration = execution.duration_ms
        if duration is None and finished and execution.started_at:
            duration = max(0, int((finished - execution.started_at).total_seconds() * 1000))
        rows.append({
            'id': execution.pk, 'agent_name': execution.agent_name, 'node_name': execution.node_name,
            'status': run.status if interrupted else execution.status,
            'variant_number': number, 'started_at': execution.started_at, 'finished_at': finished,
            'duration_ms': duration, 'error_message': execution.error_message,
            'review_status': execution.output_payload.get('review_status'),
        })
    count = run.run_metadata.get('variant_count', 1)
    count = count if type(count) is int and 1 <= count <= 3 else 1
    count = max(count, max((row['variant_number'] for row in rows), default=1))
    # The archive is shared. Critic revisions stay inside the review milestone,
    # so discovering a repair never makes the percentage move backwards.
    total = 1 + 3 * count
    completed = int(any(row['node_name'] == 'archivist' and row['status'] == 'completed' for row in rows))
    for number in range(1, count + 1):
        variant = [row for row in rows if row['variant_number'] == number]
        completed += sum(any(row['node_name'] == node and row['status'] == 'completed' for row in variant)
                         for node in ('director', 'scenarist'))
        reviewed = any(row['node_name'] == 'critic' and row['status'] == 'completed'
                       and row['review_status'] in {'accepted', 'revision_limit_reached'} for row in variant)
        # Earlier versions did not store review outcomes per execution.
        reviewed = reviewed or any(row['variant_number'] > number and row['started_at'] is not None for row in rows)
        completed += int(reviewed)
    if run.status == 'completed':
        completed = total
    percent = round(completed / total * 100)
    if run.status != 'completed':
        percent = min(99, percent)  # 100% also confirms that variants have been saved.
    return {
        'run_id': run.pk, 'status': run.status, 'variant_count': count,
        'percent': percent, 'completed_steps': completed, 'total_steps': total,
        'started_at': run.started_at, 'finished_at': run.finished_at,
        'total_duration_ms': run.total_duration_ms, 'error_message': run.error_message,
        'agent_executions': rows,
    }
