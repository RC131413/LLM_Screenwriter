"""Compose the agents into a single-scene writing workflow."""

from typing import Any, Literal, NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

from .archivist import ArchivedContext, ArchivistAgent
from .critic import CriticAgent, SceneReview
from .director import DirectorAgent
from .scenarist import SceneRevision, ScenaristAgent


MAX_REVISIONS = 2
ReviewStatus = Literal['accepted', 'revision_requested', 'revision_limit_reached']


class SceneGraphInput(TypedDict):
    user_prompt: str
    context: dict[str, Any]


class SceneGraphState(SceneGraphInput):
    archived_context: NotRequired[ArchivedContext]
    beats: NotRequired[list[str]]
    scene_text: NotRequired[str]
    scene_blocks: NotRequired[list[dict[str, str]]]
    scene_heading: NotRequired[dict[str, str] | None]
    revision_count: NotRequired[int]
    critic_feedback: NotRequired[str]
    critic_review: NotRequired[SceneReview]
    review_status: NotRequired[ReviewStatus]


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
    critic = CriticAgent()

    def archive(state: SceneGraphState) -> dict[str, ArchivedContext]:
        return {'archived_context': archivist.prepare_context(
            user_prompt=state['user_prompt'], context=state['context'],
        )}

    def plan(state: SceneGraphState) -> dict[str, list[str]]:
        return {'beats': director.plan_scene(
            user_prompt=state['user_prompt'], context=_writing_context(state),
        )}

    def write(state: SceneGraphState) -> dict[str, Any]:
        revision: SceneRevision | None = None
        revision_count = state.get('revision_count', 0)
        if 'scene_text' in state:
            revision_count += 1
            revision = {
                'previous_draft': state['scene_text'],
                'feedback': state['critic_feedback'],
                'required_changes': [
                    finding.model_dump(mode='json')
                    for finding in state['critic_review'].findings if finding.severity == 'required'
                ],
            }
        draft = scenarist.write_scene_draft(
            user_prompt=state['user_prompt'], context=_writing_context(state), beats=state['beats'],
            revision=revision,
        )
        return {
            'scene_text': draft.text, 'scene_blocks': draft.blocks, 'scene_heading': draft.heading,
            'revision_count': revision_count,
        }

    def review(state: SceneGraphState) -> dict[str, SceneReview | str]:
        assessment = critic.review_scene(
            state['scene_text'], user_prompt=state['user_prompt'],
            context=_writing_context(state) | {'beats': state['beats']},
        )
        status: ReviewStatus
        if not assessment.needs_revision:
            status = 'accepted'
        elif state['revision_count'] >= MAX_REVISIONS:
            status = 'revision_limit_reached'
        else:
            status = 'revision_requested'
        return {'critic_review': assessment, 'critic_feedback': assessment.feedback, 'review_status': status}

    def route_after_review(state: SceneGraphState) -> Literal['scenarist', '__end__']:
        return 'scenarist' if state['review_status'] == 'revision_requested' else END

    workflow = StateGraph(SceneGraphState, input_schema=SceneGraphInput)
    workflow.add_node('archivist', archive)
    workflow.add_node('director', plan)
    workflow.add_node('scenarist', write)
    workflow.add_node('critic', review)
    workflow.add_edge(START, 'archivist')
    workflow.add_edge('archivist', 'director')
    workflow.add_edge('director', 'scenarist')
    workflow.add_edge('scenarist', 'critic')
    workflow.add_conditional_edges('critic', route_after_review)
    return workflow.compile()


scene_graph = build_scene_graph()
