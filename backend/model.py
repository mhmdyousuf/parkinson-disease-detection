"""
model.py — Fixed version
Bug fixed: duplicate TremorModel class (second was overwriting first)
"""
import numpy as np
import pickle
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score


class TremorModel:
    """Train, save, load, and predict tremor classification."""

    def __init__(self):
        self.model = RandomForestClassifier(n_estimators=100, random_state=42)

    def train(self, X, y):
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42
        )
        self.model.fit(X_train, y_train)
        preds = self.model.predict(X_test)
        acc   = accuracy_score(y_test, preds)
        print(f"Model Accuracy: {acc * 100:.2f}%")
        return acc

    def predict(self, features):
        features = np.array(features).reshape(1, -1)
        return self.model.predict(features)[0]

    def save(self, path="tremor_model.pkl"):
        joblib.dump(self.model, path)
        print(f"Model saved to {path}")

    def load(self, path="tremor_model.pkl"):
        self.model = joblib.load(path)
        print(f"Model loaded from {path}")
