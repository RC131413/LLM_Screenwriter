"""Compose the agents into a single-scene writing workflow."""

from typing import Any, NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

from .archivist import ArchivedContext, ArchivistAgent
from .director import DirectorAgent
from .scenarist import ScenaristAgent


class SceneGraphInput(TypedDict):
    user_prompt: str
    context: dict[str, Any]


class SceneGraphState(SceneGraphInput):
    archived_context: NotRequired[ArchivedContext]
    beats: NotRequired[list[str]]
    scene_text: NotRequired[str]


def _writing_context(state: SceneGraphState) -> dict[str, Any]:
    """Keep scene settings and use the archive in place of raw history and cast."""
    source = state['context']
    archived = state['archived_context'].model_dump(mode='json')
    for character in archived['characters']:
        name = character['name'].casefold()
        profiles = [
            card.get('voice_profile') for card in source.get('characters', [])
            if card['name'].strip().casefold() == name
        ]
        if len(profiles) == 1 and profiles[0]:
            character['voice_profile'] = profiles[0]
    return source | archived


def build_scene_graph():
    """Compile the writing workflow for a caller-supplied context snapshot."""
    archivist = ArchivistAgent()
    director = DirectorAgent()
    scenarist = ScenaristAgent()

    def archive(state: SceneGraphState) -> dict[str, ArchivedContext]:
        return {'archived_context': archivist.prepare_context(
            user_prompt=state['user_prompt'], context=state['context'],
        )}

    def plan(state: SceneGraphState) -> dict[str, list[str]]:
        return {'beats': director.plan_scene(
            user_prompt=state['user_prompt'], context=_writing_context(state),
        )}

    def write(state: SceneGraphState) -> dict[str, str]:
        return {'scene_text': scenarist.write_scene(
            user_prompt=state['user_prompt'], context=_writing_context(state), beats=state['beats'],
        )}

    workflow = StateGraph(SceneGraphState, input_schema=SceneGraphInput)
    workflow.add_node('archivist', archive)
    workflow.add_node('director', plan)
    workflow.add_node('scenarist', write)
    workflow.add_edge(START, 'archivist')
    workflow.add_edge('archivist', 'director')
    workflow.add_edge('director', 'scenarist')
    workflow.add_edge('scenarist', END)
    return workflow.compile()


scene_graph = build_scene_graph()
