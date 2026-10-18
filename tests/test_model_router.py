"""A keyless router answers every prompt with a notice; that is not a model.

`get_chat_model` never returns None, so a caller that only checks for None will
read the notice as content: a section whose explanation is a quota message, or a
chapter titled after one. Anything that has to tell "the model answered" from
"the model could not be asked" goes through `get_usable_chat_model`.
"""

import core.model_router as router
import core.section_composer as sc


def test_a_keyless_router_is_not_a_usable_model(monkeypatch):
    monkeypatch.setattr(router, "get_chat_model", lambda **kwargs: router.RobustFallbackChatModel())

    assert router.get_chat_model() is not None, "the router always returns something"
    assert router.get_usable_chat_model() is None


def test_a_working_model_passes_through(monkeypatch):
    sentinel = object()
    monkeypatch.setattr(router, "get_chat_model", lambda **kwargs: sentinel)

    assert router.get_usable_chat_model(api_key="k") is sentinel


def test_none_from_the_router_is_not_a_usable_model(monkeypatch):
    monkeypatch.setattr(router, "get_chat_model", lambda **kwargs: None)

    assert router.get_usable_chat_model() is None


def test_the_composer_never_renders_a_notice_as_notes(monkeypatch):
    """End to end: a stub model must produce the honest notice, not its own text."""
    monkeypatch.setattr(
        sc, "get_usable_chat_model", lambda **kwargs: None
    )

    out = sc.compose_section("Gating", "Recurrent networks", "The hidden state is gated. " * 30)

    assert out["degraded"] is True
    assert out["explanation"].startswith("### This section could not be written up")
    assert "no model was available" in out["explanation"]
