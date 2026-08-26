from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotificationOut(BaseModel):
    id: str
    recipient_user_id: str
    notification_type: str
    title: str
    body: str
    source_module: str
    source_record_id: str | None
    deep_link_path: str | None
    is_read: bool
    read_at: datetime | None
    model_config = ConfigDict(from_attributes=True)
