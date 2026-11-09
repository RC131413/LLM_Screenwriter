"""Structural bounds, not a blacklist of words or screenplay/code quotations."""


def validate_data_tree(data, *, max_depth=16, max_nodes=20000):
    stack = [(data, 0)]
    nodes = 0
    while stack:
        value, depth = stack.pop()
        nodes += 1
        if depth > max_depth or nodes > max_nodes:
            raise ValueError('Dane są zbyt złożone.')
        if isinstance(value, str):
            if len(value) > 262144 or any((ord(char) < 32 and char not in '\t\r\n') or 0xD800 <= ord(char) <= 0xDFFF for char in value):
                raise ValueError('Tekst jest zbyt długi lub zawiera niedozwolone znaki sterujące.')
        elif isinstance(value, dict):
            if len(value) > max_nodes:
                raise ValueError('Dane są zbyt złożone.')
            stack.extend((item, depth + 1) for item in value.values())
            stack.extend((key, depth + 1) for key in value)
        elif isinstance(value, list):
            if len(value) > max_nodes:
                raise ValueError('Dane są zbyt złożone.')
            stack.extend((item, depth + 1) for item in value)
