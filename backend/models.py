from sqlalchemy import Column, Integer, String, Float
from database import Base

class TestHistoryDB(Base):
    __tablename__ = "test_history"
    id = Column(Integer, primary_key=True, index=True)
    patient_name = Column(String)
    timestamp = Column(String)
    prediction = Column(String)
    frequency_hz = Column(Float)
    severity = Column(String)
