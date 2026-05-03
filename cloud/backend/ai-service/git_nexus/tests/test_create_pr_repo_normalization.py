import unittest

from git_nexus.routes.api import normalize_github_repo_input


class CreatePrRepoNormalizationTests(unittest.TestCase):
    def test_normalizes_common_github_repo_inputs(self) -> None:
        self.assertEqual(
            normalize_github_repo_input("deekshithgowda85/Agile_Scrum_Master"),
            "deekshithgowda85/Agile_Scrum_Master",
        )
        self.assertEqual(
            normalize_github_repo_input("https://github.com/deekshithgowda85/Agile_Scrum_Master.git"),
            "deekshithgowda85/Agile_Scrum_Master",
        )
        self.assertEqual(
            normalize_github_repo_input("git@github.com:deekshithgowda85/Agile_Scrum_Master.git"),
            "deekshithgowda85/Agile_Scrum_Master",
        )


if __name__ == "__main__":
    unittest.main()