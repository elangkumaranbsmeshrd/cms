"""Masters §3.6's biometric-attendance gate.

The spec adds this toggle marked "New in this revision", and defines its Off
state as an active refusal rather than a mere default: "any inbound device
payload is rejected", and Payroll -> Attendance's Biometric Feed tab must show
the integration as "available-but-inactive rather than pretending a device
exists". A spec-inventory pass found both fields absent at every layer — screen,
schema and table.

Two properties are worth pinning, because getting either wrong reopens a hole
rather than merely losing a field:

  1. Off is the DEFAULT and it is False, not None. A profile that has never been
     told anything about biometric input must read as explicitly refusing it. A
     NULL would be ambiguous, and some later caller would eventually read it as
     permission.

  2. The endpoint is CONDITIONALLY required — mandatory exactly while the toggle
     is On. §3.6: "Where the feed comes from, recorded so the source of an
     attendance record is auditable." Switching the gate open without recording
     the source would accept device writes nobody can trace.

The rule is enforced in the write schema rather than as a DB CHECK: a CHECK
expressing "endpoint required when toggle on" would also have to accept every
existing row that has the toggle Off and no endpoint, and the conditional form
is clearer stated once, in the place that produces the 422.
"""

import pytest
from pydantic import ValidationError

from app.schemas.masters import CompanyProfileWrite


def _profile(**overrides) -> dict:
    body = {
        "legal_name": "Meshrd Technologies Private Limited",
        "cin": "U72900TN2019PTC131234",
        "pan": "AABCM1234C",
        "company_type": "PRIVATE_LIMITED",
        "year_of_incorporation": 2019,
        "phone": "9876543210",
        "official_email": "hello@meshrd.in",
    }
    body.update(overrides)
    return body


def test_biometric_attendance_defaults_to_off_and_is_false_not_none():
    # §3.6: "Defaults to Off." A profile that has said nothing about biometric
    # input must refuse it, and must say so unambiguously.
    profile = CompanyProfileWrite(**_profile())
    assert profile.biometric_attendance is False
    assert profile.biometric_device_endpoint is None


def test_the_endpoint_is_not_required_while_the_gate_is_closed():
    # The conditional cuts both ways: an Off profile with no endpoint is the
    # normal, valid state, and must never be forced to invent a feed source.
    profile = CompanyProfileWrite(**_profile(biometric_attendance=False, biometric_device_endpoint=None))
    assert profile.biometric_attendance is False


def test_turning_the_gate_on_without_naming_the_feed_source_is_rejected():
    # The property that matters: device writes cannot be enabled without
    # recording where they will come from, or an attendance record's source
    # stops being auditable — which is the whole reason §3.6 makes the field
    # conditional rather than optional.
    with pytest.raises(ValidationError) as exc:
        CompanyProfileWrite(**_profile(biometric_attendance=True, biometric_device_endpoint=None))
    assert "Biometric Device Endpoint" in str(exc.value)


def test_whitespace_is_not_a_feed_source():
    # A space satisfies "not None" and satisfies nothing else. Without the
    # strip() the gate could be opened with a blank reference, which is the
    # same failure as opening it with none.
    with pytest.raises(ValidationError):
        CompanyProfileWrite(**_profile(biometric_attendance=True, biometric_device_endpoint="   "))


def test_the_gate_opens_when_the_feed_source_is_named():
    profile = CompanyProfileWrite(
        **_profile(biometric_attendance=True, biometric_device_endpoint="https://devices.internal/biometric/feed")
    )
    assert profile.biometric_attendance is True
    assert profile.biometric_device_endpoint == "https://devices.internal/biometric/feed"
