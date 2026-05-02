import tempfile
import unittest
from unittest.mock import patch

from git_nexus.analyzer import GitNexusAnalyzer
from git_nexus.sandbox import NexusSandboxManager


class RepoUrlNormalizationTests(unittest.TestCase):
    def test_sandbox_normalizes_common_github_inputs(self) -> None:
        manager = NexusSandboxManager()

        self.assertEqual(
            manager._normalize_repo_url("deekshithgowda85/Agile_Scrum_Master"),
            "https://github.com/deekshithgowda85/Agile_Scrum_Master",
        )
        self.assertEqual(
            manager._normalize_repo_url("https://github.com/deekshithgowda85/Agile_Scrum_Master.git"),
            "https://github.com/deekshithgowda85/Agile_Scrum_Master",
        )
        self.assertEqual(
            manager._normalize_repo_url("git@github.com:deekshithgowda85/Agile_Scrum_Master.git"),
            "https://github.com/deekshithgowda85/Agile_Scrum_Master",
        )

    def test_analyzer_private_clone_uses_canonical_url(self) -> None:
        analyzer = GitNexusAnalyzer(repo_path=tempfile.mkdtemp())

        captured = {}

        def fake_clone_from(url, path, **kwargs):
            captured["url"] = url
            captured["path"] = path
            captured["kwargs"] = kwargs
            return object()

        with patch("git_nexus.analyzer.Repo.clone_from", side_effect=fake_clone_from):
            result = analyzer.clone_repo(
                "deekshithgowda85/Agile_Scrum_Master",
                github_token="secret-token",
                branch="main",
            )

        self.assertTrue(result)
        self.assertEqual(
            captured["url"],
            "https://secret-token@github.com/deekshithgowda85/Agile_Scrum_Master",
        )
        self.assertEqual(captured["path"], analyzer.repo_path)
        self.assertEqual(captured["kwargs"].get("branch"), "main")

    def test_analyzer_normalizes_repo_url_for_output(self) -> None:
        analyzer = GitNexusAnalyzer()
        self.assertEqual(
            analyzer._normalize_repo_url("git@github.com:owner/repo.git"),
            "https://github.com/owner/repo",
        )


if __name__ == "__main__":
    unittest.main()